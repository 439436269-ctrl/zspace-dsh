"use strict";
// Thin client for the ZSpace Docker API, using the logged-in browser cookies.
// usage: node zd.js <endpoint> [GET|POST] [jsonBody]
const fs = require("fs");
const http = require("http");

const BASE = "http://127.0.0.1:13579";
const STATE = "D:\\codes\\.zspace-shots\\state.json";

function cookie() {
  const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
  return (st.cookies || []).map((c) => `${c.name}=${c.value}`).join("; ");
}

function rnd() {
  return `${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}_${Math.floor(Math.random() * 9000 + 1000)}`;
}

function call(endpoint, method = "GET", body) {
  const url = new URL(`${BASE}${endpoint}${endpoint.includes("?") ? "&" : "?&"}rnd=${rnd()}&webagent=v2`);
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve) => {
    const headers = { Cookie: cookie(), Accept: "application/json", Referer: `${BASE}/home/` };
    if (payload !== null) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const req = http.request(
      { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, headers, timeout: 120000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, text: "ERR " + e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, text: "timeout" }); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

module.exports = { call };

if (require.main === module) {
  (async () => {
    const r = await call(process.argv[2], process.argv[3] || "GET",
      process.argv[4] ? JSON.parse(process.argv[4]) : undefined);
    console.log(r.text);
  })();
}
