#!/usr/bin/env node
/**
 * DSH HTTP API 桥 —— 把 `dsh --profile headless` 包成网络 API，用于「对话 + coding」。
 *
 * 为什么需要它：DSH 自己对外只有两种面——
 *   - `dsh web`（19387）：界面走 **WebSocket**（dsh-api-gateway），/api/* 全是 404，不是 REST；
 *   - `dsh --profile sdk`：**stdio** JSON-RPC，客户端得自己拉起进程。
 * 没有一个能"从网络直接连、用普通 HTTP 调用"的入口。这个桥补的就是这一层。
 *
 * 为什么基于 headless 而不是 sdk：
 *   `dsh --profile headless --json` 自带 `--session-id`，能续接持久化会话，
 *   并且事件流里第一行就给出 sessionId —— 多轮对话和 coding 都够用，且是无状态进程、
 *   不需要维护常驻 JSON-RPC 连接，稳定性远高于自己实现 sdk 协议。
 *
 * 接口：
 *   GET  /health                         → { ok, pid, uptimeMs, dsh, workspace }
 *   POST /v1/ask                         → { ok, answer, sessionId, usage, ms }
 *        headers: X-API-Key: <key>
 *        body:    { "task": "...", "sessionId": "session-…" (可选，续接上一轮) }
 *   两条都需要鉴权（除 /health）。
 *
 * 鉴权：从 /dsh/conf/api-key.txt 读一次性密钥（读文件而不是环境变量，
 *       这样轮换密钥不用重建容器）。**文件不存在或为空就拒绝一切请求**（fail-closed），
 *       因为这个接口等价于"在你的 NAS 上执行任意 DSH 任务"，绝不能裸奔。
 *
 * 并发：所有请求**串行排队**。DSH 是单 agent，并行跑同一会话会互相踩。
 */
"use strict";

const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");

const PORT = Number(process.env.DSH_API_PORT || 19389);
const DSH_BIN = process.env.DSH_BIN || "/dsh/npm/bin/dsh";
// 注意：工作区在容器里挂在 /workspace（**不是** /dsh/workspace，没有 dsh/ 前缀）。
// 2026-10-18 实测：写错路径时 spawn 报 ENOENT（看起来像"命令不存在"，实际是 cwd 不存在）。
const WORKSPACE = process.env.DSH_WORKSPACE || "/workspace";
const KEY_FILE = process.env.DSH_API_KEY_FILE || "/dsh/conf/api-key.txt";
const TIMEOUT_MS = Number(process.env.DSH_API_TIMEOUT_MS || 15 * 60 * 1000);
const STARTED = Date.now();

function probePath(p) {
  try {
    const st = fs.lstatSync(p);
    let real = null;
    try { real = fs.realpathSync(p); } catch {}
    return { exists: true, symlink: st.isSymbolicLink(), real, mode: (st.mode & 0o777).toString(8) };
  } catch {
    return { exists: false };
  }
}
const CWD = (() => { try { return fs.statSync(WORKSPACE).isDirectory() ? WORKSPACE : "/"; } catch { return "/"; } })();

function log(msg) {
  console.log(`[dsh-api] ${new Date().toISOString()} ${msg}`);
}

function apiKey() {
  try {
    const k = fs.readFileSync(KEY_FILE, "utf8").trim();
    return k.length >= 16 ? k : null;
  } catch {
    return null;
  }
}

/** 串行队列：保证同一时刻只有一个 dsh 子在跑。 */
let chain = Promise.resolve();
function serialize(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

/** 跑一次 headless，解析 NDJSON 事件，返回关键信息。
 *
 * spawn 的三级回退（2026-10-18 实测踩过）：
 *   直接 spawn 一个带 shebang 的脚本时，若 shebang 解释器不在 PATH 上，
 *   Node 报的是 **ENOENT**（看起来像"文件不存在"，极容易误判成路径写错）。
 *   bash 跑同一个路径却是好的——因为它用 SHELL 的 PATH。
 *   所以这里逐级退：原样 → 显式 node → PATH 里的 node。
 */
function runHeadless(task, sessionId) {
  return new Promise((resolve) => {
    const args = ["--profile", "headless", "--json"];
    if (sessionId) args.push("--session-id", sessionId);
    args.push(task);

    const attempts = [
      { cmd: DSH_BIN, argv: args, label: "direct" },
      { cmd: process.execPath, argv: [DSH_BIN, ...args], label: "node+script" },
      { cmd: "node", argv: [DSH_BIN, ...args], label: "node(PATH)+script" },
    ];

    const t0 = Date.now();

    function attempt(i) {
      if (i >= attempts.length) {
        log(`fail 全部 spawn 方式都失败 ${Date.now() - t0}ms  dsh=${JSON.stringify(probePath(DSH_BIN))} cwd=${CWD}`);
        return resolve({ ok: false, error: `无法启动 dsh：已试 ${attempts.map((a) => a.label).join(" / ")}，均 ENOENT。诊断见 /health`, code: -1, ms: Date.now() - t0 });
      }
      const a = attempts[i];
      let spawned = false;
      const p = spawn(a.cmd, a.argv, { cwd: CWD, env: process.env });
      let out = "";
      let err = "";
      const timer = setTimeout(() => { try { p.kill("SIGTERM"); } catch {} }, TIMEOUT_MS);

      p.stdout.on("data", (d) => { out += d.toString("utf8"); });
      p.stderr.on("data", (d) => { err += d.toString("utf8"); });

      p.on("spawn", () => { spawned = true; if (i > 0) log(`spawn 回退成功：${a.label}`); });

      p.on("close", (code) => {
        clearTimeout(timer);
        if (!spawned && code === -2) { attempt(i + 1); return; }   // ENOENT → 换下一种
        let sid = sessionId || null, answer = null, usage = null, errorText = null;
        for (const line of out.split("\n")) {
          const s = line.trim();
          if (!s.startsWith("{")) continue;
          let ev;
          try { ev = JSON.parse(s); } catch { continue; }
          if (ev.type === "session" && ev.sessionId) sid = ev.sessionId;
          else if (ev.type === "final") answer = ev.text;
          else if (ev.type === "status" && ev.phase === "step_end" && ev.usage) usage = ev.usage;
          else if (ev.type === "error") errorText = ev.text || JSON.stringify(ev);
        }
        const ms = Date.now() - t0;
        if (code === 0 && answer !== null) {
          log(`ok  sid=${sid} ${ms}ms ${String(task).slice(0, 60)}`);
          resolve({ ok: true, answer, sessionId: sid, usage, ms });
        } else {
          const why = errorText || (err.trim().split("\n").slice(-4).join(" / ") || `exit ${code}`);
          log(`fail exit=${code} via=${a.label} ${ms}ms ${why.slice(0, 200)}`);
          resolve({ ok: false, error: why, code, sessionId: sid, ms, answer });
        }
      });

      p.on("error", (e) => {
        clearTimeout(timer);
        if (e.code === "ENOENT") { attempt(i + 1); return; }
        resolve({ ok: false, error: `spawn failed: ${e.message}`, code: -1, ms: Date.now() - t0 });
      });
    }
    attempt(0);
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const c = [];
    let n = 0;
    req.on("data", (d) => {
      n += d.length;
      if (n > 8 * 1024 * 1024) { req.destroy(); resolve(null); return; }
      c.push(d);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(c).toString("utf8") || "{}")); } catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");

  if (url.pathname === "/health") {
    return json(res, 200, {
      ok: true, pid: process.pid, uptimeMs: Date.now() - STARTED,
      dsh: DSH_BIN, dshProbe: probePath(DSH_BIN),
      workspace: CWD, nodePath: process.execPath,
      authConfigured: Boolean(apiKey()),
    });
  }

  const key = apiKey();
  if (!key) return json(res, 503, { ok: false, error: `鉴权未配置：请把密钥写入 ${KEY_FILE}（≥16 字符）。出于安全，未配置时拒绝一切请求。` });
  if (req.headers["x-api-key"] !== key) return json(res, 401, { ok: false, error: "X-API-Key 不正确" });

  if (url.pathname === "/v1/ask" && req.method === "POST") {
    const body = await readBody(req);
    if (!body || typeof body.task !== "string" || !body.task.trim()) {
      return json(res, 400, { ok: false, error: "body 需要 { task: \"...非空字符串\", sessionId?: \"session-…\" }" });
    }
    const result = await serialize(() => runHeadless(body.task, body.sessionId));
    return json(res, result.ok ? 200 : 500, result);
  }

  json(res, 404, { ok: false, error: "可用：GET /health、POST /v1/ask" });
});

server.listen(PORT, "0.0.0.0", () => {
  log(`DSH HTTP API 桥已启动 http://<极空间IP>:${PORT}/  dsh=${DSH_BIN}  cwd=${CWD}`);
  log(`dsh 探测：${JSON.stringify(probePath(DSH_BIN))}  node=${process.execPath}`);
  log(`鉴权：${apiKey() ? "已配置（从 " + KEY_FILE + " 读取）" : "⚠️ 未配置，将拒绝一切请求"}`);
});
