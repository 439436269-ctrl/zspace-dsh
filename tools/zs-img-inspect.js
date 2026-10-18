"use strict";
// Inspect the already-local llama.cpp image: which backends/binaries ship inside.
const { call } = require("./zs-docker-api.js");

const IMG = process.argv[2] || "ghcr.io/ggml-org/llama.cpp:server";
const SH = "ls -la /app | head -40; echo '--- so ---'; ls /app/*.so* 2>/dev/null | head -40; echo '--- bins ---'; ls /app | grep -E '^(llama-|rpc-server)' ; echo '--- vulkan icd ---'; ls /usr/share/vulkan/icd.d 2>/dev/null; echo '--- tools ---'; command -v vulkaninfo llama-bench 2>/dev/null; echo '--- done ---'";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const body = {
    Hostname: "", Domainname: "", Image: IMG,
    Cmd: ["-c", SH], Entrypoint: ["/bin/sh"],
    Env: ["TZ=Asia/Shanghai"], ExposedPorts: {}, Volumes: {}, Labels: {},
    MacAddress: "", OpenStdin: false, Tty: false,
    HostConfig: {
      AutoRemove: false, Binds: ["/tmp/zfsv3/sata1/public/公共分组/docker/models:/models:ro"],
      CapAdd: [], CapDrop: [], Devices: [{ PathOnHost: "/dev/dri", PathInContainer: "/dev/dri", CgroupPermissions: "rwm" }],
      Dns: [], ExtraHosts: [], Init: false, Memory: 0, MemoryReservation: 0, NanoCpus: 0,
      NetworkMode: "bridge", PortBindings: {}, Privileged: false, PublishAllPorts: false,
      RestartPolicy: { MaximumRetryCount: 0, Name: "no" }, Runtime: null, Sysctls: {},
    },
    NetworkingConfig: { EndpointsConfig: { bridge: { IPAMConfig: { IPv4Address: "", IPv6Address: "" } } } },
    Chmod: "", CronStartEnable: false, CronStopEnable: false,
    CronStartDow: "", CronStopDow: "", CronStartHour: "", CronStopHour: "",
    CronStartMinute: "", CronStopMinute: "",
  };
  const name = "img-inspect-" + Date.now();
  const created = await call(`/zdocker/container_create?name=${name}`, "POST", body);
  let id = null;
  try { id = JSON.parse(created.text).data.Id; } catch (e) { console.log("CREATE:", created.text.slice(0, 400)); return; }
  await call(`/zdocker/container_op?container_id=${id}&action=start`);
  await sleep(5000);
  const logs = await call(`/zdocker/container_logs?container_id=${id}&tail=300`);
  try {
    const j = JSON.parse(logs.text);
    console.log(typeof j.data === "string" ? j.data : JSON.stringify(j.data));
  } catch (e) { console.log("LOGS_RAW:", logs.text.slice(0, 1200)); }
  await call(`/zdocker/container_op?container_id=${id}&action=remove`);
  console.log("(container removed)");
})();
