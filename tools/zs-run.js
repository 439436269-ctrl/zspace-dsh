"use strict";
// Generic one-shot runner: executes a shell script inside a throwaway container
// on the ZSpace NAS and streams its logs back.
//
// usage: node tools/zs-run.js <image> <script.sh> [--gpu] [--wait seconds]
const fs = require("fs");
const { call } = require("./zs-docker-api.js");

const [image, scriptFile] = process.argv.slice(2);
const useGpu = process.argv.includes("--gpu");
const waitArg = process.argv.indexOf("--wait");
const maxWait = (waitArg > 0 ? Number(process.argv[waitArg + 1]) : 300) * 1000;
const script = fs.readFileSync(scriptFile, "utf8");

const MODELS_HOST = "/tmp/zfsv3/sata1/public/公共分组/docker/models";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const body = {
    Hostname: "", Domainname: "", Image: image,
    Cmd: ["-c", script], Entrypoint: ["/bin/sh"],
    Env: ["TZ=Asia/Shanghai"], ExposedPorts: {}, Volumes: {}, Labels: {},
    MacAddress: "", OpenStdin: false, Tty: false,
    HostConfig: {
      AutoRemove: false,
      Binds: [`${MODELS_HOST}:/models:ro`],
      CapAdd: [], CapDrop: [],
      Devices: useGpu ? [{ PathOnHost: "/dev/dri", PathInContainer: "/dev/dri", CgroupPermissions: "rwm" }] : [],
      Dns: [], ExtraHosts: [], Init: false, Memory: 0, MemoryReservation: 0, NanoCpus: 0,
      NetworkMode: "bridge", PortBindings: {}, Privileged: false, PublishAllPorts: false,
      RestartPolicy: { MaximumRetryCount: 0, Name: "no" }, Runtime: null, Sysctls: {},
    },
    NetworkingConfig: { EndpointsConfig: { bridge: { IPAMConfig: { IPv4Address: "", IPv6Address: "" } } } },
    Chmod: "", CronStartEnable: false, CronStopEnable: false,
    CronStartDow: "", CronStopDow: "", CronStartHour: "", CronStopHour: "",
    CronStartMinute: "", CronStopMinute: "",
  };

  const name = "bench-" + Date.now();
  const created = await call(`/zdocker/container_create?name=${name}`, "POST", body);
  let id = null;
  try { id = JSON.parse(created.text).data.Id; } catch (e) { console.log("CREATE FAIL:", created.text.slice(0, 500)); return; }
  console.log("container:", name, id.slice(0, 12), "gpu:", useGpu);
  await call(`/zdocker/container_op?container_id=${id}&action=start`);

  let seen = 0;
  const t0 = Date.now();
  let status = "running";
  while (Date.now() - t0 < maxWait) {
    await sleep(8000);
    const logs = await call(`/zdocker/container_logs?container_id=${id}&tail=2000`);
    let text = "";
    try { const j = JSON.parse(logs.text); text = typeof j.data === "string" ? j.data : ""; } catch (e) {}
    const lines = text.split("\n");
    // strip the log driver's leading garbage byte + RFC3339 timestamp
    const clean = lines.map((l) => l.replace(/^.\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, ""));
    if (clean.length > seen) {
      const fresh = clean.slice(seen).filter((l) => l.trim() !== "");
      if (fresh.length) console.log(fresh.join("\n"));
      seen = clean.length;
    }
    const info = await call(`/zdocker/container_info?container_id=${id}`);
    try {
      const st = JSON.parse(info.text).data.State;
      status = st.Status; if (st.Status !== "running") { console.log(`[state] ${st.Status} exit=${st.ExitCode} oomKilled=${st.OOMKilled} error=${st.Error || ""}`); break; }
    } catch (e) {}
  }

  await call(`/zdocker/container_op?container_id=${id}&action=remove`);
  console.log("(container removed)");
})();
