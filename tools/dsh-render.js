"use strict";
// 用本机无头 Chrome + CDP 真正"看"NAS 上的 DSH 页面：
//   注入极空间会话 cookie → 打开稳定入口 → 截图 + 读渲染后的 DOM 文本
// 这样就不必再靠猜。
const fs = require("fs");
const path = require("path");

const CDP = "http://127.0.0.1:9222";
const START = "https://remote-access-19388.zconnect.cn/";
const OUT = "D:\\codes\\.zspace-shots\\render";
fs.mkdirSync(OUT, { recursive: true });

const cookies = (() => {
  const st = JSON.parse(fs.readFileSync("D:\\codes\\.zspace-shots\\state.json", "utf8"));
  return (st.cookies || []).map((c) => ({ name: c.name, value: c.value }));
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newTarget() {
  const res = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!res.ok) throw new Error("json/new failed: " + res.status);
  return res.json();
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.id !== void 0 && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.method + " " + JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(method + " timeout")); }, 45000);
    });
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return "(异常: " + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description) + ")";
    return r.result && r.result.value;
  }
  async shot(name) {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const file = path.join(OUT, name + ".png");
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }
}

async function connect() {
  const target = await newTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("ws error")));
    setTimeout(() => reject(new Error("ws timeout")), 15000);
  });
  return new Session(ws);
}

/** 按可见文本点一个元素（React 里 click() 通常够用）。 */
const clickByText = (text) => `(() => {
  const t = ${JSON.stringify(text)};
  const nodes = [...document.querySelectorAll('button,a,div,span,li')];
  const hit = nodes.filter((el) => (el.textContent || '').trim() === t);
  const el = hit[hit.length - 1];
  if (!el) return 'not-found';
  el.click();
  return 'clicked:' + el.tagName + '.' + (el.className || '').toString().slice(0, 40);
})()`;

(async () => {
  const s = await connect();
  await s.send("Network.enable");
  await s.send("Page.enable");

  console.log("=== 注入会话 cookie 到 .zconnect.cn ===");
  let ok = 0, bad = [];
  for (const c of cookies) {
    const r = await s.send("Network.setCookie", { name: c.name, value: c.value, domain: ".zconnect.cn", path: "/", secure: true });
    if (r && r.success) ok++; else bad.push(c.name);
  }
  console.log(`  成功 ${ok}/${cookies.length}${bad.length ? "  失败: " + bad.join(",") : ""}`);

  console.log("\n=== 打开稳定入口 ===", START);
  await s.send("Page.navigate", { url: START });
  await sleep(10000);
  console.log("  当前 URL:", await s.evaluate("location.href"));
  console.log("  标题:", await s.evaluate("document.title"));
  console.log("  正文前 300 字:", String(await s.evaluate("document.body.innerText")).replace(/\s+/g, " ").slice(0, 300));
  console.log("  截图:", await s.shot("01-entry"));

  // 打开设置
  console.log("\n=== 点「设置」 ===");
  console.log(" ", await s.evaluate(clickByText("设置")));
  await sleep(2500);
  const navText = await s.evaluate("document.body.innerText");
  console.log("  设置侧栏文本:", String(navText).replace(/\s+/g, " ").slice(0, 400));
  console.log("  截图:", await s.shot("02-settings"));

  // 点「模型」（库存页）
  console.log("\n=== 点「模型」 ===");
  console.log(" ", await s.evaluate(clickByText("模型")));
  await sleep(4000);
  const modelsText = await s.evaluate("document.body.innerText");
  console.log("  模型页文本:\n----\n" + String(modelsText).slice(0, 1200) + "\n----");
  console.log("  截图:", await s.shot("03-models"));

  // 点「模型（远程）」（我那页）
  console.log("\n=== 点「模型（远程）」 ===");
  console.log(" ", await s.evaluate(clickByText("模型（远程）")));
  await sleep(4000);
  const remoteText = await s.evaluate("document.body.innerText");
  console.log("  远程页文本:\n----\n" + String(remoteText).slice(0, 1500) + "\n----");
  console.log("  截图:", await s.shot("04-remote"));

  // 展开「＋ 添加模型提供商」
  console.log("\n=== 点「＋ 添加模型提供商」 ===");
  console.log(" ", await s.evaluate(clickByText("＋ 添加模型提供商")));
  await sleep(2500);
  console.log("  截图:", await s.shot("05-remote-expanded"));

  // 控制台里有没有报错
  const errs = await s.evaluate("(globalThis.__cdpErrors || []).join(' | ').slice(0,500)");
  console.log("\n=== 页面已记录的错误 ===", errs || "(未采集)");
  console.log("\n截图目录:", OUT);
})();
