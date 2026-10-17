"use strict";
// Extract one file out of an asar archive to a real path.
// usage: node asar-extract.js <asar> <innerName> <outPath>
const fs = require("fs");
const ASAR = process.argv[2];
const INNER = process.argv[3];
const OUT = process.argv[4];

const fd = fs.openSync(ASAR, "r");
const b8 = Buffer.alloc(8); fs.readSync(fd, b8, 0, 8, 0);
const pickleSize = b8.readUInt32LE(4);
const b4 = Buffer.alloc(4); fs.readSync(fd, b4, 0, 4, 12);
const strSize = b4.readUInt32LE(0);
const hb = Buffer.alloc(strSize); fs.readSync(fd, hb, 0, strSize, 16);
const header = JSON.parse(hb.toString("utf8"));
const dataStart = 8 + pickleSize;

let found = null;
(function walk(node, prefix) {
  for (const key of Object.keys(node.files || {})) {
    const child = node.files[key];
    const cur = prefix ? prefix + "/" + key : key;
    if (child.files) walk(child, cur);
    else if (cur === INNER) found = child;
  }
})(header, "");

if (!found) { console.error("not found: " + INNER); process.exit(1); }
const buf = Buffer.alloc(found.size);
fs.readSync(fd, buf, 0, found.size, dataStart + Number(found.offset));
fs.writeFileSync(OUT, buf);
console.log(`extracted ${INNER} (${found.size}B) -> ${OUT}`);
