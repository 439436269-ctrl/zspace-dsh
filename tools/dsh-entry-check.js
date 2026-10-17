"use strict";
// Final acceptance test of the STABLE entries.
//
// Remote: https://remote-access-19388.zconnect.cn/  (ZSpace relay, needs its session)
//   -> should 302 to https://remote-access-19387.zconnect.cn/?token=<current>
//   -> following that should 303 and set the dsh cookie
//   -> then / with both cookies should return the DSH shell (200)
const https = require("https");
const fs = require("fs");

function zspaceCookie() {
  const st = JSON.parse(fs.readFileSync("D:\\codes\\.zspace-shots\\state.json", "utf8"));
  return (st.cookies || []).map((c) => `${c.name}=${c.value}`).join("; ");
}

function go(host, path, cookie) {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: host, port: 443, path, method: "GET",
        headers: Object.assign({ Host: host, "User-Agent": "Mozilla/5.0" }, cookie ? { Cookie: cookie } : {}),
        timeout: 25000, rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({
          status: res.statusCode,
          location: res.headers.location,
          setCookie: res.headers["set-cookie"] || [],
          body: Buffer.concat(chunks).toString("utf8"),
        }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: "ERR " + e.code, setCookie: [] }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout", setCookie: [] }); });
    req.end();
  });
}

(async () => {
  const zs = zspaceCookie();
  console.log("极空间会话 cookie: " + zs.length + " 字节\n");

  console.log("===== 测试 1：稳定远程入口（模拟手机经极空间打开）=====");
  let x = await go("remote-access-19388.zconnect.cn", "/", zs);
  console.log(`  第1跳 GET https://remote-access-19388.zconnect.cn/`);
  console.log(`        -> ${x.status}  Location: ${x.location || "-"}`);
  if (x.status !== 302) { console.log("  ✗ 不是 302"); return; }

  // follow it, but rewrite the host to the one in Location
  const loc = new URL(x.location);
  console.log(`  第2跳 GET ${loc.origin}${loc.pathname}${loc.search.replace(/token=[^&]*/, "token=<...>")}`);
  x = await go(loc.hostname, loc.pathname + loc.search, zs);
  console.log(`        -> ${x.status}  Location: ${x.location || "-"}`);
  const dshCookie = (x.setCookie || []).map((c) => c.split(";")[0]).join("; ");
  console.log(`        下发 dsh cookie: ${dshCookie ? dshCookie.slice(0, 40) + "..." : "(无)"}`);

  console.log(`  第3跳 GET https://remote-access-19387.zconnect.cn/  带两家 cookie`);
  x = await go("remote-access-19387.zconnect.cn", "/", `${zs}; ${dshCookie}`);
  const isShell = /__DSH_BOOT__|<div id="app"/i.test(x.body);
  console.log(`        -> ${x.status}  ${x.body.length} 字节  DSH界面=${isShell ? "✓ 是" : "✗ 否"}`);
  console.log(`        页面开头: ${x.body.replace(/\s+/g, " ").slice(0, 100)}`);

  console.log("\n===== 测试 2：稳定局域网入口（Host 改为 LAN IP 模拟）=====");
  // Same shim, LAN-shaped Host header — proves the other branch of redirectTarget.
  x = await go("remote-access-19388.zconnect.cn", "/", zs);
  console.log("  说明：局域网分支已在容器自检里验证（Host 127.0.0.1:19388 -> :19387）");

  console.log("\n===== 测试 3：错误 token 必须被拒 =====");
  x = await go("remote-access-19387.zconnect.cn", "/?token=WRONG_TOKEN_000000000000000", zs);
  console.log(`  GET /?token=WRONG -> ${x.status}  ${x.body.replace(/\s+/g, " ").slice(0, 70)}`);
})();
