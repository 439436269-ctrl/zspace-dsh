"use strict";
// Raw HTTP probe with a real Host override, to test the /api Host-Origin fence.
// usage: node hostprobe.js <port> <hostHeader> [path]
const http = require("http");
const port = Number(process.argv[2]);
const hostHeader = process.argv[3];
const path = process.argv[4] || "/";

const req = http.request(
  {
    host: "127.0.0.1",
    port,
    path,
    method: "GET",
    headers: { Host: hostHeader },
    setHost: false,
  },
  (res) => {
    console.log(`Host: ${hostHeader}${path.startsWith("/?") ? " (with token)" : ""} -> HTTP ${res.statusCode}` + (res.headers["set-cookie"] ? "  [set-cookie]" : ""));
    res.resume();
  }
);
req.on("error", (e) => console.log(`Host: ${hostHeader} -> ERR ${e.message}`));
req.end();
