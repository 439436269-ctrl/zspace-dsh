"use strict";
// Fetch the ZSpace NAS web UI through the local desktop-client gateway using
// the already-logged-in token from vuex.json.
const fs = require("fs");
const http = require("http");
const path = require("path");

const BASE = "http://127.0.0.1:13579";

function loadCfg() {
  const p = path.join(process.env.APPDATA || "", "zspace", "vuex.json");
  const d = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  const s = d.state || d;
  return {
    token: s.user.token,
    nasId: s.nas.nasId,
    deviceId: s.app.deviceId,
    version: s.app.version,
  };
}

function get(cfg, urlPath, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: 13579,
        path: urlPath,
        headers: Object.assign(
          {
            Cookie: `token=${cfg.token}; zenithtoken=${cfg.token}; nas_id=${cfg.nasId}; nasid=${cfg.nasId}; device_id=${cfg.deviceId}`,
            Accept: "*/*",
            "User-Agent": "Mozilla/5.0",
          },
          extraHeaders || {}
        ),
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
  });
}

(async () => {
  const cfg = loadCfg();
  const target = process.argv[2] || "/home/";
  const out = process.argv[3];
  const r = await get(cfg, target);
  console.error("status=" + r.status + " location=" + (r.headers.location || "-") + " bytes=" + r.body.length);
  const text = r.body.toString("utf8");
  console.error("head: " + text.slice(0, 400).replace(/\s+/g, " "));
  if (out) {
    fs.writeFileSync(out, r.body);
    console.error("wrote " + out);
  }
  const scripts = [...text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
  console.error("scripts: " + JSON.stringify(scripts));
})().catch((e) => {
  console.error("ERR " + e.message);
  process.exit(1);
});
