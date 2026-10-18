"use strict";
// One-shot GPU probe: creates a throwaway node:latest container with /dev/dri
// passed through, prints /sys + /dev evidence, then removes the container.
const { call } = require("./zs-docker-api.js");

const PROBE = [
  "const f=require('fs');const o=[];",
  "const rd=p=>{try{return f.readFileSync(p,'utf8').trim()}catch(e){return '-'}};",
  "const ex=p=>f.existsSync(p);",
  "o.push('dev_dri_exists='+ex('/dev/dri'));",
  "try{o.push('dev_dri_ls='+f.readdirSync('/dev/dri').join(','))}catch(e){o.push('dev_dri_err='+e.code)}",
  "o.push('dev_card0='+ex('/dev/dri/card0')+' dev_renderD128='+ex('/dev/dri/renderD128'));",
  "o.push('proc_dri0='+rd('/proc/dri/0/name'));",
  "o.push('proc_meminfo='+rd('/proc/meminfo').split('\\n').slice(0,3).join(' | '));",
  "try{o.push('drm_class='+f.readdirSync('/sys/class/drm').join(','))}catch(e){}",
  "o.push('uevent='+rd('/sys/class/drm/card0/device/uevent').split('\\n').join(' | '));",
  "o.push('vendor='+rd('/sys/class/drm/card0/device/vendor')+' device_id='+rd('/sys/class/drm/card0/device/device'));",
  "try{const p='/sys/bus/pci/devices';for(const d of f.readdirSync(p)){const c=rd(p+'/'+d+'/class');if(c.indexOf('0x03')===0)o.push('PCI '+d+' class='+c+' ven='+rd(p+'/'+d+'/vendor')+' dev='+rd(p+'/'+d+'/device')+' drv='+(f.existsSync(p+'/'+d+'/driver')?f.readlinkSync(p+'/'+d+'/driver'):'-'))}}catch(e){o.push('pci_err='+e.message)}",
  "console.log(o.join('\\n'));",
].join("");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  const body = {
    Hostname: "", Domainname: "", Image: "node:latest",
    Cmd: ["node", "-e", PROBE], Entrypoint: null,
    Env: ["TZ=Asia/Shanghai"],
    ExposedPorts: {}, Volumes: {}, Labels: {}, MacAddress: "",
    OpenStdin: false, Tty: false,
    HostConfig: {
      AutoRemove: false, Binds: [], CapAdd: [], CapDrop: [],
      Devices: [{ PathOnHost: "/dev/dri", PathInContainer: "/dev/dri", CgroupPermissions: "rwm" }],
      Dns: [], ExtraHosts: [], Init: false, Memory: 0, MemoryReservation: 0, NanoCpus: 0,
      NetworkMode: "bridge", PortBindings: {}, Privileged: false, PublishAllPorts: false,
      RestartPolicy: { MaximumRetryCount: 0, Name: "no" }, Runtime: null, Sysctls: {},
    },
    NetworkingConfig: { EndpointsConfig: { bridge: { IPAMConfig: { IPv4Address: "", IPv6Address: "" } } } },
    Chmod: "", CronStartEnable: false, CronStopEnable: false,
    CronStartDow: "", CronStopDow: "", CronStartHour: "", CronStopHour: "",
    CronStartMinute: "", CronStopMinute: "",
  };

  const name = "gpu-probe-" + Date.now();
  const created = await call(`/zdocker/container_create?name=${name}`, "POST", body);
  console.log("CREATE:", created.text.slice(0, 400));
  let id = null;
  try { id = JSON.parse(created.text).data.Id; } catch (e) {}
  if (!id) return;

  await call(`/zdocker/container_op?container_id=${id}&action=start`);
  await sleep(4000);
  const info = await call(`/zdocker/container_info?container_id=${id}`);
  try {
    const s = JSON.parse(info.text).data;
    console.log("STATE:", JSON.stringify({ status: s.State && s.State.Status, exit: s.State && s.State.ExitCode, err: s.State && s.State.Error }));
  } catch (e) { console.log("INFO_RAW:", info.text.slice(0, 300)); }

  const logs = await call(`/zdocker/container_logs?container_id=${id}&tail=200`);
  try {
    const j = JSON.parse(logs.text);
    console.log("--- LOGS ---");
    console.log(typeof j.data === "string" ? j.data : JSON.stringify(j.data));
  } catch (e) { console.log("LOGS_RAW:", logs.text.slice(0, 800)); }

  const rm = await call(`/zdocker/container_op?container_id=${id}&action=remove`);
  console.log("REMOVE:", rm.text.slice(0, 200));
})();
