"use strict";
// Context grep for minified single-line bundles.
// usage: node ctxgrep.js <file> <regex> [width] [maxHits]
const fs = require("fs");
const file = process.argv[2];
const needle = process.argv[3];
const width = Number(process.argv[4] || 200);
const maxHits = Number(process.argv[5] || 10);
const text = fs.readFileSync(file, "utf8");
const rx = new RegExp(needle, "g");
let m, n = 0;
while ((m = rx.exec(text)) !== null && n < maxHits) {
  n++;
  const from = Math.max(0, m.index - width);
  const to = Math.min(text.length, m.index + m[0].length + width);
  console.log("@" + m.index + " …" + text.slice(from, to).replace(/\s+/g, " ") + "…\n");
  rx.lastIndex = m.index + 1;
}
if (n === 0) console.log("(no match)");
