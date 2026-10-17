#!/usr/bin/env node
/**
 * 稳定入口 —— 反向代理版（v2，2026-10-16）
 *
 * 为什么从"重定向"改成"代理"：
 *
 *   v1 的做法是 302 跳到 `http://<当前Host的主机名>:19387/?token=...`。
 *   局域网直连时没问题（两个端口都在 NAS 上）。但**走极空间客户端的隧道时会断**：
 *
 *     客户端隧道 127.0.0.1:<本地随机端口> → NAS:19388
 *     浏览器拿到 302 → http://127.0.0.1:19387/?token=...
 *                        ^^^^^^^^^^^^^^^ 这是【客户端设备】的 19387，不是 NAS 的！
 *
 *   实测两种失败：手机上 `127.0.0.1:20080` 打到了 DSH 但没 token → 401；
 *   另一条则直接"网页无法打开"。而且 PC 上 19387 常被本机 DSH 占用，更加不可能。
 *
 *   现在改成代理：**客户端只会用到它隧道的那一个端口**，代理在 NAS 内部访问
 *   `127.0.0.1:19387`（在这里 127.0.0.1 就是 NAS 自己），并把 DSH 下发的
 *   auth cookie 自动带上。于是：
 *     - 局域网 `http://<IP>:19388/` 直接就是 DSH 界面（不再跳转、URL 里没有 token）
 *     - 隧道 `127.0.0.1:<任意本地端口>/` 同样直接是 DSH 界面
 *     - 客户端设备上 19387 有没有被占，都与本方案无关
 *
 * 需要处理 WebSocket：DSH 的界面走 ws（dsh-api-gateway 的 stream-client），
 * 所以必须转发 upgrade，否则会话流式输出会断。
 *
 * 环境变量（由 entrypoint.sh 传入，与 v1 一致）：
 *   DSH_LOG         DSH 的日志文件（从里面读当前 token）
 *   DSH_PORT        DSH 监听的端口（默认 19387）
 *   DSH_ENTRY_PORT  本服务监听的端口（默认 19388）
 */
"use strict";

const http = require("http");
const fs = require("fs");

const LOG = process.env.DSH_LOG || "/dsh/home/container.log";
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = Number(process.env.DSH_PORT || 19387);
const LISTEN_PORT = Number(process.env.DSH_ENTRY_PORT || 19388);
const TAIL_BYTES = 128 * 1024;
const COOKIE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时；DSH 的签名 cookie 本身是 30 天

function log(msg) {
  console.log(`[entry-proxy] ${new Date().toISOString()} ${msg}`);
}

/** 只读日志尾部，取最后一次出现的 token。 */
function currentToken() {
  try {
    const st = fs.statSync(LOG);
    const start = Math.max(0, st.size - TAIL_BYTES);
    const fd = fs.openSync(LOG, "r");
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const all = [...buf.toString("utf8").matchAll(/[?&]token=([A-Za-z0-9_-]{20,})/g)];
    return all.length ? all[all.length - 1][1] : null;
  } catch {
    return null;
  }
}

// ── 用 token 换 DSH 的 auth cookie，并缓存 ──────────────────────────────────
let cached = { token: null, cookie: null, at: 0 };
let inflight = null;

function fetchAuthCookie(token) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: TARGET_HOST,
        port: TARGET_PORT,
        path: `/?token=${encodeURIComponent(token)}`,
        method: "GET",
        headers: { Host: `${TARGET_HOST}:${TARGET_PORT}`, "User-Agent": "entry-proxy" },
      },
      (res) => {
        const sc = res.headers["set-cookie"] || [];
        res.resume();
        const auth = sc
          .map((s) => String(s).split(";")[0])
          .filter((s) => /dsh-auth/i.test(s));
        resolve(auth.length ? auth.join("; ") : null);
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function authCookie() {
  const token = currentToken();
  if (!token) return null;
  if (cached.token === token && cached.cookie && Date.now() - cached.at < COOKIE_TTL_MS) {
    return cached.cookie;
  }
  if (!inflight) {
    inflight = fetchAuthCookie(token)
      .then((c) => {
        if (c) cached = { token, cookie: c, at: Date.now() };
        return c;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** 把上游返回的绝对 Location 改写成相对路径，避免浏览器被带去未隧道的端口。 */
function rewriteLocation(loc) {
  if (!loc) return loc;
  const m = /^https?:\/\/[^/]+(\/.*)?$/i.exec(String(loc));
  if (m) return m[1] || "/";
  return loc;
}

/** 构造转发给 DSH 的请求头：Host 必须是 DSH 认的，并注入 auth cookie。 */
function upstreamHeaders(req, cookie) {
  const h = Object.assign({}, req.headers);
  h.host = `${TARGET_HOST}:${TARGET_PORT}`;
  if (cookie) h.cookie = h.cookie ? `${h.cookie}; ${cookie}` : cookie;
  return h;
}

const server = http.createServer(async (req, res) => {
  let cookie = null;
  try { cookie = await authCookie(); } catch {}
  if (!cookie) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("dsh 还没起来（或日志里还没有 token），等几秒刷新一下。\n");
    return;
  }

  const p = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers: upstreamHeaders(req, cookie) },
    (pr) => {
      const headers = Object.assign({}, pr.headers);
      if (headers.location) headers.location = rewriteLocation(headers.location);
      res.writeHead(pr.statusCode, headers);
      pr.pipe(res);
    }
  );
  p.on("error", (e) => {
    log(`upstream error ${req.method} ${req.url}: ${e.message}`);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("upstream error\n");
  });
  req.pipe(p);
});

// ── WebSocket：DSH 的界面走 ws，必须转发 upgrade ────────────────────────────
server.on("upgrade", async (req, socket, head) => {
  let cookie = null;
  try { cookie = await authCookie(); } catch {}
  if (!cookie) { socket.destroy(); return; }

  const p = http.request({
    host: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: "GET",
    headers: upstreamHeaders(req, cookie),
  });

  p.on("upgrade", (pr, upstream, upstreamHead) => {
    const lines = ["HTTP/1.1 101 Switching Protocols"];
    for (const [k, v] of Object.entries(pr.headers)) lines.push(`${k}: ${v}`);
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    if (upstreamHead && upstreamHead.length) socket.write(upstreamHead);
    if (head && head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    log(`ws upgraded ${req.url}`);
  });
  p.on("error", () => socket.destroy());
  p.end();
});

/** 自检：从本机请求自己一次，确认能拿到 DSH 的界面而不是 401。 */
let selfTested = false;
function selfTest(attempt) {
  if (selfTested) return;
  if (!currentToken()) {
    if (attempt < 60) setTimeout(() => selfTest(attempt + 1), 3000);
    else log("自检放弃：等了 3 分钟仍没读到 token");
    return;
  }
  selfTested = true;
  const r = http.get(
    { host: "127.0.0.1", port: LISTEN_PORT, path: "/", headers: { Host: `127.0.0.1:${LISTEN_PORT}` } },
    (res) => {
      const ok = res.statusCode === 200;
      log(`自检${ok ? "通过" : "异常"}: status=${res.statusCode} （200 = 代理出去的是 DSH 界面；401 = token 没生效）`);
      res.resume();
    }
  );
  r.on("error", (e) => log(`自检失败: ${e.code}`));
}

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  log(`稳定入口（代理模式）http://<极空间IP>:${LISTEN_PORT}/  ->  ${TARGET_HOST}:${TARGET_PORT}`);
  setTimeout(() => selfTest(0), 3000);
});
