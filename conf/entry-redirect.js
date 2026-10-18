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

/**
 * 老浏览器兼容垫片（2026-10-18 实测需要）
 *
 * 极空间 PC 客户端的内置浏览器内核比 Chromium 116 老，而 DSH 的界面用了
 * `AbortSignal.any()`（Chromium 116+）。不垫的话打开界面会卡在
 * 「选择工作区目录」并报 `AbortSignal.any is not a function`。
 *
 * 只在新浏览器上没有对应 API 时才生效，老/新浏览器都安全。
 * 顺便把同批次（Chromium 90~110 区间）常见缺失的 API 一并补上，
 * 避免修了一个再报下一个。
 */
const POLYFILL = `<script>(function(){
  try{
    if(!AbortSignal.any) AbortSignal.any=function(sigs){
      var c=new AbortController(), f=function(){c.abort();}, i, s;
      for(i=0;i<sigs.length;i++){ s=sigs[i];
        if(s.aborted){ f(); break; }
        s.addEventListener("abort", f, {once:true});
      }
      return c.signal; };
    if(!AbortSignal.timeout) AbortSignal.timeout=function(ms){
      var c=new AbortController();
      setTimeout(function(){ try{c.abort(new DOMException("TimeoutError","TimeoutError"));}catch(e){c.abort();} }, ms);
      return c.signal; };
    if(!Object.hasOwn) Object.hasOwn=function(o,k){ return Object.prototype.hasOwnProperty.call(o,k); };
    if(!Array.prototype.at) Array.prototype.at=function(n){ n=Math.trunc(n)||0; if(n<0)n+=this.length;
      return (n<0||n>=this.length)?undefined:this[n]; };
    if(!Array.prototype.findLast) Array.prototype.findLast=function(f,t){
      for(var i=this.length-1;i>=0;i--){ if(f.call(t,this[i],i,this)) return this[i]; } };
    if(!Array.prototype.findLastIndex) Array.prototype.findLastIndex=function(f,t){
      for(var i=this.length-1;i>=0;i--){ if(f.call(t,this[i],i,this)) return i; } return -1; };
    if(!String.prototype.replaceAll) String.prototype.replaceAll=function(p,r){
      return (p instanceof RegExp)?this.replace(p,r):this.split(p).join(r); };
    if(!String.prototype.at) String.prototype.at=function(n){ n=Math.trunc(n)||0; if(n<0)n+=this.length;
      return (n<0||n>=this.length)?undefined:this[n]; };
    if(!Promise.withResolvers) Promise.withResolvers=function(){
      var a,b,p=new Promise(function(x,y){a=x;b=y;}); return {promise:p,resolve:a,reject:b}; };
    if(!Array.prototype.toSorted) Array.prototype.toSorted=function(c){ return this.slice().sort(c); };
    if(!Array.prototype.toReversed) Array.prototype.toReversed=function(){ return this.slice().reverse(); };
  }catch(e){ console.warn("[polyfill]",e); }
  try{ if(!window.structuredClone) window.structuredClone=function(v){
    return (typeof v==="undefined")?v:JSON.parse(JSON.stringify(v)); }; }catch(e){}
})();</script>`;

/** 这几种路径返回的是 HTML，需要注入垫片。 */
function isHtmlPath(p) {
  const path = String(p || "/").split("?")[0];
  return path === "/" || path === "/index.html" || path.endsWith(".html");
}

const server = http.createServer(async (req, res) => {
  let cookie = null;
  try { cookie = await authCookie(); } catch {}
  if (!cookie) {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("dsh 还没起来（或日志里还没有 token），等几秒刷新一下。\n");
    return;
  }

  const html = isHtmlPath(req.url);
  const headers = upstreamHeaders(req, cookie);
  // 要改写 HTML 就必须拿到明文：这几种路径上去掉 accept-encoding（体积很小，不值得为它解压）
  if (html) delete headers["accept-encoding"];

  const p = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers },
    (pr) => {
      const outHeaders = Object.assign({}, pr.headers);
      if (outHeaders.location) outHeaders.location = rewriteLocation(outHeaders.location);

      if (html && pr.statusCode === 200) {
        const chunks = [];
        pr.on("data", (c) => chunks.push(c));
        pr.on("end", () => {
          let body = Buffer.concat(chunks).toString("utf8");
          // 垫片要在应用脚本之前执行：插在 </head> 前，退而求其次插在 <body> 后
          if (body.includes("</head>")) body = body.replace("</head>", POLYFILL + "</head>");
          else if (body.includes("<body")) body = body.replace(/<body[^>]*>/, (m) => m + POLYFILL);
          const buf = Buffer.from(body, "utf8");
          // 必须同时清掉 content-length（要重算）和 transfer-encoding（上游是分块的话会和
          // content-length 冲突，表现为 HPE_INVALID_CONTENT_LENGTH —— 2026-10-18 实测踩过）
          delete outHeaders["content-length"];
          delete outHeaders["content-encoding"];
          delete outHeaders["transfer-encoding"];
          outHeaders["content-length"] = buf.length;
          res.writeHead(pr.statusCode, outHeaders);
          res.end(buf);
          log(`已注入兼容垫片 ${
            req.url}（${buf.length}B）`);
        });
        return;
      }

      res.writeHead(pr.statusCode, outHeaders);
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
