"use strict";
// Delete a file on the NAS via /v2/file/remove, using the desktop client's
// gateway + logged-in token (same auth model as list_public.js).
// usage: node zs-rm.js <remote-path>
const fs = require("fs");
const http = require("http");
const path = require("path");

const BASE = process.env.ZS_BASE_URL || "http://127.0.0.1:13579";

function cfg() {
  const p = path.join(process.env.APPDATA || "", "zspace", "vuex.json");
  const d = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  const s = d.state || d;
  return {
    token: s.user.token,
    nasId: s.nas.nasId,
    deviceId: s.app.deviceId,
    version: s.app.version || "1.0",
    device: s.app.device || s.app.ua || "",
  };
}

function q(c) {
  return {
    token: c.token, nasid: c.nasId, plat: "web", version: c.version,
    device_id: c.deviceId, _l: "zh_cn",
    rnd: `${Date.now()}${Math.floor(Math.random() * 9000 + 1000)}`,
    webagent: "v2",
  };
}

function post(c, endpoint, fields) {
  const body = new URLSearchParams(
    Object.entries({ ...q(c), ...fields }).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = new URL(`${BASE}${endpoint}?&${new URLSearchParams(q(c)).toString()}`);
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: `token=${c.token}; zenithtoken=${c.token}; nas_id=${c.nasId}; nasid=${c.nasId}; device_id=${c.deviceId}`,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (x) => chunks.push(x));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      }
    );
    req.on("error", (e) => resolve("ERR " + e.message));
    req.write(body);
    req.end();
  });
}

(async () => {
  const target = process.argv[2];
  if (!target) { console.error("usage: node zs-rm.js <remote-path>"); process.exit(2); }
  const c = cfg();
  console.log(await post(c, "/v2/file/remove", { "paths[]": target }));
})();
