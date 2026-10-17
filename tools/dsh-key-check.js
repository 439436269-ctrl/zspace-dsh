"use strict";
// Inspect the raw response for the model ids DSH may send.
const https = require("https");
const fs = require("fs");
const yaml = require("C:/Users/19592/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/js-yaml");

const key = yaml.load(fs.readFileSync("C:\\Users\\<user>\\.dsh\\.credentials.yaml", "utf8")).refs.DEEPSEEK_API_KEY;

function raw(model, maxTokens) {
  const body = JSON.stringify({
    model,
    messages: [{ role: "user", content: "回复两个字：可以" }],
    max_tokens: maxTokens,
    stream: false,
  });
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.deepseek.com", port: 443, path: "/chat/completions", method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Content-Length": Buffer.byteLength(body) },
        timeout: 90000,
      },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString("utf8") }));
      }
    );
    req.on("error", (e) => resolve({ status: 0, body: "ERR " + e.code }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
    req.write(body);
    req.end();
  });
}

(async () => {
  for (const [m, mt] of [["deepseek-flash", 64], ["deepseek-reasoner", 256]]) {
    const r = await raw(m, mt);
    console.log(`\n===== ${m} (max_tokens=${mt}) HTTP ${r.status} =====`);
    console.log(r.body.slice(0, 700));
  }
})();
