# 极空间 Docker API 参考（社区逆向整理）

> 环境：极空间 **Z4S**（`nasId <NAS_SERIAL>`，x86_64，内核 5.17.13，系统 `zos`）
> 网页端版本：`2.3.2026082801`
> 整理时间：2026-10-14
> **非官方文档**。接口是社区逆向所得，极空间固件升级后可能变化。

## 0. 可靠性说明

本文分三类内容，请区别对待：

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 我真的发过请求、贴的是真实响应 |
| 📖 **读码** | 从网页端 JS 里读出的调用签名，未逐个实测 |
| ❓ **未验证** | 只看到接口名，参数形状未确认 |

---

## 1. 接入方式

### 1.1 唯一的入口：桌面客户端的本地网关

```
http://127.0.0.1:13579
```

极空间桌面客户端（Electron）在本地跑了一个 openresty 网关，把请求经**极空间自己的中转**
转发到 NAS。**为什么必须用它**：实测同一 NAS 的局域网端口在跨网段时被大量过滤
（60+ 端口 closed/filtered），而 13579 这条隧道始终可用。

客户端还开了几个本地端口（实测）：

| 端口 | 用途 |
|---|---|
| `12345` | SDK 诊断 HTTP 服务，**绑在 `0.0.0.0`**，`/netinfo` 暴露 nasId 和实时隧道列表 ⚠️ |
| `13579` | NAS 网页版 / 文件 API 网关 |
| `13580` / `13581` | 同步类服务（非 HTTP） |
| `13590` | → NAS `22345`（P2P 视图） |
| `13600` | → NAS `9001`（HTTP，全部返回 401） |
| `13619` | 非 HTTP |

隧道机制来自客户端主进程（`background.js` 反编译）：

```js
libzrpc_start_service({ local_port, remote_port, type: 1, nas_id, request_purpose })
// 13579 ← 5055  网页版
//       ← 8050  文件服务
//       ← 22000（request_purpose 7）
```

### 1.2 网页端会话（登录门）

网页端**不接受**直接把账号 token 放进 cookie 使用（实测控制台报
`tokenEmpty: true`、`N001208 token已失效`）。必须走登录流程：

```
1. 打开 http://127.0.0.1:13579/home/login
2. 填账号 + 密码，点「登录」
3. 弹「新终端登录安全验证」→ 选「短信验证码验证」
4. 填短信验证码 → 「验证通过 / 安全验证通过 / 正在重新登录...」
5. 关键：勾上「保持自动登录」，否则会话不会持久化（实测不勾，重启浏览器即掉线）
```

账号密码在 `~/.agents/skills/zspace-webdav/SKILL.md` 里（`账号：` / `密码：`）。

登录成功后，从浏览器持久化 profile 导出 cookie 即可脱离浏览器调 API。实测**只要
Cookie 就够了**，不需要额外的 token 参数：

```
Cookie: <登录后 profile 里的全部 cookie>
```

### 1.3 请求约定

```
POST http://127.0.0.1:13579/zdocker/<action>?&rnd=<毫秒时间戳>_<随机数>&webagent=v2
Cookie: <会话 cookie>
```

**响应包封**（几乎统一）：

```json
{ "code": "200", "ts": 1791969049131, "msg": "200", "data": { ... } }
```

- 成功判定：`code === "200"`（字符串）或 `json.success === true`
- 失败时 `code` 常常**是错误信息本身**，例如
  `{"code":"image_name is empty"}`、`{"code":"invalid reference format"}`。
  **这是探参数名的好办法**：空参调用，报错会告诉你缺什么。
- 路由不存在 → `404 page not found`（openresty 的，不是 JSON）

**Content-Type 的坑（实测）**：

- `/zdocker/*` 绝大多数 `POST` 用 **JSON**
- `/shortcut/*` 必须用 **表单编码** `application/x-www-form-urlencoded`。
  发 JSON 会返回 `code:200` 但**字段存成空**（实测：快捷方式变成空名空链接）

---

## 2. 接口总表

### 2.1 系统 / 概览

| 接口 | 方法 | 说明 | 状态 |
|---|---|---|---|
| `/zdocker/system_info` | GET | Docker 引擎信息（内核、架构、镜像源、容器数） | ✅ |
| `/zdocker/system_status` | GET | 运行状态（`{"status":"on"}`） | ✅ |
| **`/zdocker/system_restart`** | **POST** | **重启 Docker 引擎**（UI 里那个「重启Docker引擎」按钮）。⚠️ **是 POST，用 GET 会 404** | ✅ |
| `/zdocker/system_reset` | POST | **重置 Docker 引擎**（`timeout` 180s）。☠️ **会清掉容器/镜像，别乱调** | 📖 |
| `/zdocker/system_switch` | GET | Docker 服务开关（`params`） | 📖 |
| `/zdocker/docker_info` | GET | 同上，另一入口 | 📖 |
| `/zdocker/system_read_events_logs` | GET | 事件流 | 📖 |
| `/zdocker/system_upgrade_task_list` | GET | 升级任务 | 📖 |

`system_info` 实测返回（节选）：

```json
{"ID":"8fd1915d-...","Containers":5,"ContainersRunning":4,"Images":8,
 "Driver":"overlay2","KernelVersion":"5.17.13-generic","OperatingSystem":"zos",
 "Architecture":"x86_64","CgroupVersion":"1",
 "RegistryConfig":{"IndexConfigs":{"docker.io":{"Mirrors":[
   "https://dockerpull.org/","https://docker.ketches.cn/",
   "https://registry.zenithspace.net/","https://registry-1.docker.io/"]}}}}
```

**镜像源是这里读出来的**，解释了为什么"搜索搜不到但按名字能拉"。

### 2.2 容器

| 接口 | 方法 | 参数 | 状态 |
|---|---|---|---|
| `/zdocker/v2/container_list` | POST | body `{}` | ✅ |
| `/zdocker/container_list` | GET | — | 📖 |
| `/zdocker/container_create` | POST | query `name`，body 见 §3.2 | ✅ |
| `/zdocker/container_update` | POST | query `container_id`,`name`，body 同上 | 📖 |
| `/zdocker/container_op` | GET | `container_id`,`action` = `start` / `stop` / **`remove`** | ✅ |
| `/zdocker/container_info` | GET | **`container_id`**（不是 `id`） | ✅（参数名踩过） |
| `/zdocker/container_logs` | GET | `container_id`,`tail` | ✅ |
| `/zdocker/container_stats` | GET | — | ✅ |
| `/zdocker/container_top` | GET | `container_id` | 📖 |
| `/zdocker/container_stats_style` | GET/POST | 显示偏好 | 📖 |
| `/zdocker/container_convert_compose` | POST | 容器转 compose | 📖 |
| `/zdocker/v2/container_list_filter_{state,sort,order,class}` | GET/POST | 列表筛选偏好 | ✅（列表页会调） |

`action` 取值（读码 + 常规）：`start` / `stop` / `restart` / `kill` / `pause` / `unpause` / `remove`

### 2.3 镜像

| 接口 | 方法 | 参数 | 状态 |
|---|---|---|---|
| `/zdocker/local_image_list` | GET | — | ✅ |
| `/zdocker/v2/local_image_list` | POST | — | 📖 |
| `/zdocker/image_pull` | GET | **`image_name` + `image_tag`** | ✅ ⚠️ 见 §3.1 |
| `/zdocker/image_pull_task_list` | GET | — | ✅ |
| `/zdocker/image_pull_task_cancel` | GET | `id` | 📖 |
| `/zdocker/image_info` | GET | `image_id` | ✅（列表页会调） |
| `/zdocker/image_remove` | GET | `image_id` | 📖 |
| `/zdocker/image_force_remove` | GET | `image_id` | 📖 |
| `/zdocker/image_update` | POST | — | 📖 |
| `/zdocker/image_import` / `image_export` | — | NAS 本地镜像导入导出 | 📖 |
| `/zdocker/hub_image_search` | GET | **`term`** | ✅ |
| `/zdocker/hub_image_tags` | GET | `term` 等 | 📖 |
| `/zdocker/common_image_search` | GET | `image_name` | 📖 |
| `/zdocker/common_image_list` | GET | — | 📖 |
| `/zdocker/common_image_download` | GET | — | 📖 |
| `/zdocker/common_image_download_task_list` / `_cancel` | GET | — | 📖 |
| `/zdocker/ws/imagepull?task_id=` | WS | 拉取进度 WebSocket | 📖 |
| `/zdocker/ws/imagedownload?task_id=` | WS | 下载进度 WebSocket | 📖 |

### 2.4 网络

| 接口 | 方法 | 参数 |
|---|---|---|
| `/zdocker/network_list` | GET | — ✅ |
| `/zdocker/network_info` | GET | `network_id` ✅ |
| `/zdocker/network_create` | POST | 见下（缺名会报 `invalid name:`） ✅ |
| `/zdocker/network_remove` | GET | `network_id` |
| `/zdocker/network_attach` / `network_detach` | GET | `network_id`, `container_id` ✅（缺参报错） |
| `/zdocker/network_get_ip6tables_enable` | GET | — ✅ |
| `/zdocker/network_set_ip6tables_enable` | GET | — ✅ |

实测可用网络驱动：`bridge` / `host` / `ipvlan` / `macvlan` / `null` / `overlay`
（`host` 可用很关键，见 §3.2 末尾）

### 2.5 存储池

`/zdocker/storagepool_get_datadirconf`、`storagepool_update_disksinfo`、
`storagepool_get_datadircopy_tasks` — 📖 列表页会调

### 2.6 Compose（项目）

> ⚠️ **本节于 2026-10-15 全面修正。** 原先标为 📖 的端点名大多是**猜的**，实测
> 全部 404。下面是**从极空间网页端 chunk `1682.23cd1655.js` 里的 `ZP` API 层
> 反解出来的真实签名**，并逐条实测。关键差异：**start/stop/restart 在顶层
> `/zdocker/compose_*_project`，不在 `/v2/compose/` 下**。

| 接口 | 方法 | 参数 | 状态 |
|---|---|---|---|
| `/zdocker/v2/compose/list_projects` | POST | JSON `{}` | ✅ 实测 |
| `/zdocker/v2/compose/check_projectpath` | GET | `project_path` | ✅ 实测 |
| `/zdocker/v2/compose/check_projectname` | GET | `project_name` | 📖 读码 |
| `/zdocker/v2/compose/create_project` | POST | **form 编码**：`project_name` + `config`(YAML 正文) + `path` + `start` + `rw` | ✅ 实测（**只新建**，同名报 `Project name already exists`） |
| **`/zdocker/compose_start_project`** | **GET** | `project_id` | ✅ 实测 |
| **`/zdocker/compose_stop_project`** | **GET** | `project_id` | 📖 读码 |
| **`/zdocker/compose_restart_project`** | **GET** | `project_id` | ✅ 实测（= `compose restart`，**不重建**，改了 command 也不生效） |
| `/zdocker/v2/compose/rebuild_project` | GET | `project_id` | ✅ 实测（= `up --remove-orphans --no-start`，**会重建**容器） |
| `/zdocker/v2/compose/delete_project` | GET | `project_id` | 📖 读码 |
| `/zdocker/v2/compose/get_project_file` | GET | `project_id` | ✅ 实测（返回 `{exists, file_content}`） |
| `/zdocker/v2/compose/save_project_file` | POST | `project_id`，body 为 **`text/plain` 的 YAML 正文** | ⚠️ 实测返回 200 **但没写进去**——改文件请走文件 API |
| `/zdocker/v2/compose/list_project_containers` | GET | `project_id` | 📖 读码 |
| `/zdocker/v2/compose/logs_project` | GET | `project_id` | 📖 读码 |
| `/zdocker/v2/compose/task_list` / `task_status` / `task_cancel` | GET | `project_id` | ✅ `task_list` 实测 |
| `/zdocker/v2/compose/cron` | GET/POST | — | 📖 读码 |
| `/zdocker/v2/compose/project_list_filter_{state,sort,order}` | GET | — | 📖 读码 |

**改 compose 的正确姿势（实测踩过坑）：**

1. 用**文件 API** 覆盖 `/sata1/my/data/docker/docker-compose.yml`（`save_project_file` 不可靠）。
   文件名必须是 `docker-compose.yml`——上传 API 用**本地文件名**当远端名。
2. `GET /zdocker/v2/compose/get_project_file?project_id=<id>` **回读确认**。
3. `GET /zdocker/v2/compose/rebuild_project?project_id=<id>` 按新 yml **重建**容器
   （它会返回 `{task_id}`，是异步的；重建后容器状态是 `created`，**不会自动启动**）。
4. `GET /zdocker/compose_start_project?project_id=<id>` 启动。

> ⚠️ **端口冲突会伪装成"启动就崩"**：`rebuild_project` 建了新容器但旧容器还在时，
> 新容器会因 `Bind for 0.0.0.0:<port> failed: port is already allocated` 退出，
> **`ExitCode=128`**，而日志里**只有 llama.cpp 的启动行、没有任何报错**——
> 看起来像进程自己秒退。判据是 `container_info` 的 `State.Error`。
> 兜底：直接 `/zdocker/container_op?container_id=<id>&action=start` 手工起。

### 2.7 应用商店 / 应用

| 接口 | 方法 | 说明 | 状态 |
|---|---|---|---|
| `/zdocker/AppStore/v1/list` | POST | 应用列表（列表页**轮询**调用） | ✅ |
| `/zdocker/AppStore/v1/pkg/{info,install,preinstall,remove,start,stop,restart}` | — | 应用生命周期 | 📖 |
| `/zdocker/AppStore/v1/pkg/depend/check` | — | 依赖检查 | 📖 |
| `/zdocker/AppStore/v1/pkg/tasks` / `task/cancel` / `task/remove` | — | 任务 | 📖 |
| `/zdocker/AppStore/v1/pkg/cancel_upgrade` | — | 取消升级 | 📖 |
| `/zdocker/app_{info,install,remove,start,stop,open,state,download,check_port}` | — | 单个 app 级操作 | ✅（列表页会调 `app_open`/`app_state`） |

> 你现有容器**全部**是 `/appstore_*` 前缀（openclaw / siyuan / ddns-go / ollama / browser）
> —— 即都是从应用商店装的，不是手建的。

### 2.8 桌面快捷方式

| 接口 | 方法 | 参数 | 状态 |
|---|---|---|---|
| `/shortcut/dockershortcuts` | POST | `{}`（**表单**） | ✅ |
| `/shortcut/adddockershortcut` | POST | `name`,`link`（**表单**） | ✅ |
| `/shortcut/deletedockershortcut` | POST | ❓ 参数形状未探出 | ❓ |
| `/shortcut/renamedockershortcut` | POST | — | 📖 |
| `/shortcut/{add,delete,rename}shortcut` | POST | 通用快捷方式 | 📖 |
| `/shortcut/homeshortcut` | POST | 首页快捷方式 | 📖 |

实测：快捷方式**就是一个命名了的 http 链接**，校验规则 `^(http|https)://.+$`。

```json
{"total":2,"list":[
  {"id":1,"name":"linuxserver_calibre-web","weight":0,"link":"http://192.168.1.4:8083"},
  {"id":3,"name":"DSH","weight":0,"link":"http://<NAS-IP>:19387/"}]}
```

**这就是"把容器做成极空间桌面入口"的接口。**

### 2.9 远程访问

```
/zrps/api/remoteaccess/add      POST, requestAsJson: true      参数形状 ❓
```

UI 入口：容器列表 →「远程访问」→ `subwindows/new` 打开
`/home/remoteAccess/nas?dockerId=<id>&dockerName=<name>&ports=<public:private,...>`

远程访问列表存在 **KV 存储**里（读码）：`kvLoad({k:"remoteAccess"})`，
每项带 `dockerId`。⚠️ 实测 `/kv/load` 直接传 `{k:"remoteAccess"}` 报
`N150005 k参数不合法`，key 前缀规则未探明。

### 2.10 其它相关

| 接口 | 说明 |
|---|---|
| `/network-settings/v1/network/config/show` | 网络设置，实测只返回 `{"advanced":false}`（拿不到局域网 IP） |
| `/zddns/v1/ddns/{list,create,update,delete,refresh}` | DDNS，实测 `list` 返回空 |
| `/setting/load` | 设置文档（972 字节，无网络信息） |
| `/kv/{load,create,delete}` | KV 存储 |

---

## 3. 核心流程（实测）

### 3.1 拉镜像 ⚠️ 有坑

```http
GET /zdocker/image_pull?image_name=node&image_tag=22-bookworm-slim
```

**坑 1：只传 `image_name` 会报 `invalid reference format`。** 必须两个都传。

**坑 2（重要）：`image_tag` 会被忽略，实际拉的是 `latest`。**

实测：

```json
请求：/zdocker/image_pull?image_name=node&image_tag=22-bookworm-slim
响应：{"code":"200","data":{"id":"1791955421880555688","image_name":"node",
       "status":"Pulling","progress":"0"}}
完成：{"status":"===Pull Completed===",
       "progress":"{\"status\":\"Status: Downloaded newer image for node:latest\"}"}
```

结论：**目前只能拉 `latest`**。要精确 tag，走界面拉取。

**坑 3：搜索只匹配仓库名。** 输 `node:22-bookworm-slim` 搜不到；输 `node` 能搜到。
`hub_image_search?term=node` 正常返回（含 `node`、`nodered/node-red` 等）。

**进度查询**：`GET /zdocker/image_pull_task_list`，`status` 依次为
`Pulling` → `Downloading` → `Extracting` → `===Pull Completed===`。
重复提交会报 `创建下载镜像任务失败：存在重复的下载任务`。

### 3.2 建容器（完整参数结构）

```http
POST /zdocker/container_create?name=<容器名>
Content-Type: application/json
Cookie: <会话>
```

body 是 **Docker Engine API 的 Config+HostConfig 结构 + 极空间扩展字段**
（从建容器组件的 `transformToApiParams()` 读出）：

```jsonc
{
  // ── Docker Config ──
  "Hostname": "",
  "Domainname": "",
  "Image": "node:latest",
  "Cmd": ["bash", "/dsh/conf/entrypoint.sh"],
  "Entrypoint": null,              // null = 用镜像默认
  "Env": ["TZ=Asia/Shanghai", "K=V"],
  "ExposedPorts": { "19387/tcp": {} },
  "Volumes": { "/dsh/npm": {}, "/dsh/home": {} },
  "Labels": {},
  "MacAddress": "",
  "OpenStdin": false,
  "Tty": false,

  // ── Docker HostConfig ──
  "HostConfig": {
    "AutoRemove": false,
    "Binds": ["<宿主路径>:<容器路径>[:ro]"],
    "CapAdd": [], "CapDrop": [], "Devices": [], "Dns": [], "ExtraHosts": [],
    "Init": false, "Memory": 0, "MemoryReservation": 0, "NanoCpus": 0,
    "NetworkMode": "bridge",       // 或 "host"
    "PortBindings": { "19387/tcp": [{ "HostPort": "19387" }] },
    "Privileged": false,
    "PublishAllPorts": false,
    "RestartPolicy": { "MaximumRetryCount": 0, "Name": "always" },
    "Runtime": null,
    "Sysctls": {}
  },
  "NetworkingConfig": { "EndpointsConfig": { "bridge": { "IPAMConfig": { "IPv4Address": "", "IPv6Address": "" } } } },

  // ── 极空间扩展 ──
  "Chmod": "",
  "CronStartEnable": false, "CronStopEnable": false,
  "CronStartDow": "", "CronStopDow": "",
  "CronStartHour": "", "CronStopHour": "",
  "CronStartMinute": "", "CronStopMinute": ""
}
```

成功后返回 `{"code":"200","data":{"Id":"<容器ID>","Warnings":[]}}`。

**建完不会自动启动**，UI 会紧接着调：

```http
GET /zdocker/container_op?container_id=<id>&action=start
```

**删除容器**（2026-10-15 实测补上，原文档漏了）：

```http
GET /zdocker/container_op?container_id=<id>&action=remove
```

返回 `{"code":"200",...}` 后容器即消失。**删除动作也挂在 `container_op` 的 `action` 上**，
而不是独立端点——下面这些猜测全部 **404**：

```
/zdocker/container_remove?container_id=<id>          → 404 page not found
/zdocker/container_delete?container_id=<id>          → 404
/zdocker/v2/container_remove?container_id=<id>       → 404
```

> ⚠️ **建容器时 `AutoRemove: true` 会把日志一起带走。** 实测：跑一个探测容器验证网络，
> 容器退出后自动删除，`container_logs` 随即读不到任何内容——**关键证据丢失**。
> 要读日志就设 `AutoRemove: false`，读完再用上面的 `action=remove` 手工删。

**内存下限**：UI 里限制 `Memory >= 6291456` 字节（6MB），否则报"容器最小内存"。

#### ⚠️ 卷路径必须转换（最容易踩的坑）

`Binds` 的宿主路径**不能**直接用 `/sata1/my/...`。UI 会做转换（读码）：

```
/sata1/my/<...>   →  /tmp/zfsv3/sata1/<用户名>/<...>
/sata1/public/... →  /tmp/zfsv3/sata1/public/...
其它              →  原样
```

用户名规则：登录用户名；若**不以数字开头**则前面加下划线（`<ZSPACE_ACCOUNT>` 以数字开头，不变）。

顺带处理的磁盘别名：`zenith_sata→sata1`、`zenith_m2→nvme2`、`zenith_esata→esata3`。

只读挂载在末尾加 `:ro`。

**Compose 项目的 `path` 用同一套转换规则**（见 §3.4）。

#### 用 `host` 网络模式可以省掉一堆配置

实测可行且强烈推荐用于自建服务：`HostConfig.NetworkMode: "host"`。

好处：容器共享 NAS 的网络命名空间，容器内
`os.networkInterfaces()` 能看到 NAS 的真实网卡。对于 DSH 这类带
Host 白名单围栏的服务，意味着**局域网 IP 会被自动信任**，不需要填任何地址。

实测 NAS 的接口：
`<NAS-IP>`（局域网）、`192.168.122.1`（虚拟机网桥）、`172.18.0.1`、`172.17.0.1`（Docker 网桥）。

### 3.3 容器状态 / 日志

```http
POST /zdocker/v2/container_list   body {}
GET  /zdocker/container_logs?container_id=<id>&tail=200
```

⚠️ `container_info` 的参数名是 **`container_id`**，传 `id` 会报
`container_id or app_name is empty`。

日志响应里有多路复用流的控制字节（`\x01`、长度前缀），需要
`replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')` 清洗后再读。

### 3.4 Compose 项目

> ⚠️ **2026-10-15 修正**：`create_project` 实测吃的是 **form 编码**
> （`Content-Type: application/x-www-form-urlencoded`），**不是 JSON**。
> 送 JSON 会一直返回 `{"code":"Project name is empty"}`。字段名确认为
> `project_name`。详见 §2.6。

```http
GET  /zdocker/v2/compose/check_projectpath?project_path=<转换后的路径>
POST /zdocker/v2/compose/create_project
Content-Type: application/x-www-form-urlencoded
```

body（✅ 实测修正）：

```json
{
  "project_name": "zspace-dsh",
  "start": true,
  "config": "<compose YAML 正文>",
  "path": "/tmp/zfsv3/sata1/<ZSPACE_ACCOUNT>/data/docker/dsh",
  "rw": false,
  "env": "<.env 正文，可选>"
}
```

- `config` 是 **YAML 文本本身**（编辑器 `getValue()`），不是文件名
- `project_name` 规则：2–64 字符，首字符 `[a-z0-9]`，全体 `[a-z0-9._-]`
- `start` = 建完是否启动（UI 默认 `true`）
- 若目录里已有 yml/env，`check_projectpath` 返回 `{"result":true}`，UI 会先弹替换确认

### 3.5 桌面快捷方式

```http
POST /shortcut/adddockershortcut        （表单编码！）
name=DSH&link=http://<NAS-IP>:19387/
```

实测成功后 `dockershortcuts` 里出现该条目，**PC 客户端**的桌面会多一个图标。
⚠️ **手机 App 上看不到**——原因见 §3.7。

### 3.6 建容器后自动弹的"远程访问"

UI 建完容器并启动后，会读一次容器列表，把端口拼成 `public:private,...`，
然后弹确认框问"是否创建远程访问"，确认就跳到
`/home/remoteAccess/nas?dockerId=...&dockerName=...&ports=...`。

**这就是"通过极空间在外网访问容器"的官方路径。** 它的**存储**已经探明（不是 `/zrps/api/...`）：
条目存在 **KV 存储的 `remoteAccess` 键**里，完整机制、条目形状与读写方式见 **§3.7**。

---

### 3.7 手机 App 里怎么放自定义入口 —— `/apps/*` 与 `/kv/*`（2026-10-16 实测）

### 为什么 Docker 快捷方式在手机上看不到

极空间有**两套完全独立**的入口机制，很容易混：

| | `/shortcut/dockershortcuts` | **`/kv` 里的 `remoteAccess` 键** |
|---|---|---|
| 概念 | Docker 快捷方式 | 「远程访问」 |
| 显示在哪 | **PC 客户端**的桌面 | **手机 App ＋ PC 客户端**的「远程访问」应用 |
| 手机能看到 | ❌ **不能** | ✅ 能 |

**根因（读分片确认）**：手机主屏走 `/apps/homeappsmobile`，返回 `{home_list, lefted_list}`，
里面**只有那 42 个内置应用**（`/apps/allapps` 的目录项，字段是 `{id,title,app,weight,pinyin}`），
**结构上就不存在"Docker 快捷方式"这个类别**。所以往 `dockershortcuts` 加多少条，手机主屏都不会出现。
（「远程访问」应用本身也在 `lefted_list` 里，即**默认不在手机主屏**——要用户自己在 App 里加。）

### 「远程访问」的存储与读写

```http
POST /kv/load    （表单编码！）  k=remoteAccess
POST /kv/create  （表单编码！）  k=remoteAccess&v=<JSON 字符串>
POST /kv/delete  （表单编码！）  k=remoteAccess
```

- **`/kv/*` 和 `/shortcut/*` 一样必须表单编码**；用 JSON 会报 `N150005 k参数不合法`——
  **这报错极具误导性**，看着像键名写错了，其实是编码错了。我按 JSON 试了 6 种键名才定位到。
- `kv/create` 是 **upsert**：既能新建也能覆盖。
- 值是**一个 JSON 数组的字符串**，条目形状（实测）：

```jsonc
{
  "color": "rgb(109, 122, 178)",
  "dockerId": "<容器完整 id>",     // 手动加的条目没有这个键
  "dockerName": "zspace-dsh",
  "https": "",
  "icon": "",
  "index": null,                   // 列表里已有的条目会带序号
  "proxy": false,
  "remarks": "DSH稳定入口",         // 显示名
  "url": "127.0.0.1:19388",        // ← 见下
  "ports": "19388:19388"
}
```

- **`url` 写 `127.0.0.1:<端口>` 是故意的**：客户端/App 会把它**隧道到 NAS 的对应端口**（走极空间自己的中转），
  所以**在家和在外面都能用**，不用区分内外网。前端还会把纯数字的 `url` 自动补全：
  ```js
  /(^\d+$)|(^\d+\/)/gi.test(t.url) && (t.url = "127.0.0.1:" + t.url)
  ```
- **`type:"add"` 的条目会被前端自动清掉**：加载时若发现 `type=="add"`，会把剩下的重新 `kvCreate` 回写
  （那是"新增"对话框的临时占位，不是真条目）。**要写就写完整条目，别带 `type:"add"`。**

> ⚠️ **改动前先把原值整份读出来备份。** 这个键里可能已经有用户自己的条目（本机当时就有 3 条：
> openclaw / siyuan / DSH）。写入 = 用新数组**整份覆盖**，不是追加。

### 踩过的边界

- **`/apps/savehomeappsmobile` 的 payload 形状没探出来**：web 分片里只有导出定义、**没有调用点**
  —— 说明是**手机 App 原生代码**在调它。**别猜着写**，猜错会搞乱用户的手机主屏布局。
  要往手机主屏加图标，让用户在 App 里手动加（一下点击的事）。

---

### 3.8 Docker 子系统卡死（containerd 挂）的诊断与恢复（2026-10-16 实测）

**症状**——下面这些会**同时**出现，凑齐就基本确诊：

| 观测 | 表现 |
|---|---|
| 容器状态 | 显示 `running` / `Up N hours`，**但服务不通**（端口 502） |
| `container_top` | `dial unix:///run/containerd/containerd.sock: timeout` |
| `container_stats` | 所有容器 `cpu_usage 0.00%`、`memory_usage 0`，`update_time` 停在某一刻不动 |
| `container_op` 的 `start`/`stop`/`restart` | **返回 `{"code":"200","data":null}` 但完全不生效**（等 120 秒也不变） |
| `container_create` | **能建出来**（只写 dockerd 元数据），但随后的 `start` 报 containerd 超时 |
| 极空间中转 | 该容器端口 `502`，但**其他端口（5055/8050/9001/22345）响应正常** |

**根因**：NAS 上的 **`containerd` 挂了**。dockerd 还能读写自己的元数据（所以容器列表看着"正常"，
`system_info` 也有实时数据），但**所有容器生命周期操作都要经 containerd**，于是全部失效
——**包括"只重启某一个容器"这件事，此时根本不存在**。

**排除项**（都实测过，别在这些方向上浪费时间）：

- 磁盘没满：`storagepool_get_datadirusage` 26.5 GB；`zspace_status` 显示存储池剩 12.7 TB
- dockerd 本身活着：`system_info.SystemTime` = 当前时间、`NGoroutines` 55
- 不是网络/中转问题：同一中转下其他端口全部正常

**恢复**：

```http
POST /zdocker/system_restart        ← 是 POST！用 GET 会 404
body: {}                            ← 空对象就够（实测 POST 带 {} → {"code":"200"}）
```

实测 **15 秒内 containerd 恢复，容器按各自 restart 策略自动拉起**。
极空间自己的文案就是：「此处重启不会影响极空间其他服务，仅重启 Docker 服务。」

> ⚠️ **2026-10-17 第二次踩坑，白跑了两轮**：自己写的 `zd.js` 里 `call(endpoint, method = "GET")`
> **默认是 GET**，脚本里图省事只传了 endpoint，于是又一次发成 GET → 404 → 误判"这个接口失效了"。
>
> **方法不统一，必须逐个记住（实测）：**
>
> | 端点 | 正确方法 | 错误方法的症状 |
> |---|---|---|
> | `/zdocker/system_restart` | **POST**（body 空对象 `{}` 即可） | GET → `404 page not found` |
> | `/zdocker/container_op?container_id=…&action=start\|stop\|restart` | **GET** | **POST → `404 page not found`** |
> | `container_list` / `container_logs` / `container_stats` / `container_top` | GET | — |
>
> 所以**不要一刀切**——别以为"带动作就一定 POST"（`container_op` 恰恰是 GET）。
> **排查顺序：先确认方法，再怀疑接口**（同一个 URL `curl -X GET` 和 `-X POST` 各打一次，
> 一个 200 一个 404 就说明是方法不对）。

**两个副作用要注意**：

1. **有 restart 策略的容器会被全部拉回来**——**包括你之前手动停掉的**。
   本机实测：`mimo-llm`、`appstore_openclaw`、`appstore_siyuan` 都自己起来了，需要的话重新停。
2. **`Exited (137)` 是 SIGKILL / OOM，不是正常退出。** 本机 `browser`（KasmVNC Chrome）就是这样被杀的
   ——NAS 内存 15.42 GiB，同时跑 Chrome ＋ ollama ＋ DSH 会顶到天花板。
   **排查这类故障时要顺带扫一眼有没有 137**，那往往就是诱因。

**再次发生的规律（两次实测）**：这台 NAS 上 **containerd 会周期性 wedge**，
而且**所有容器会几乎同时变成 `Exited (137)`**（同一时间戳），
此后 `restart: always` **也救不回来**——因为它同样要经 containerd。
所以：
- **不要指望 restart 策略兜底**，出问题就按上面这套恢复。
- **同时跑多个推理容器（ollama ＋ llama.cpp）是主要诱因**，内存顶穿会触发 OOM avalanche。
- `container_stats` 全零、`container_top` 报 containerd socket 超时 = **确诊**；
  反之容器在跑、端口 200，即使 stats 解析不出来也只是**响应形状问题，不是 wedge**。

**判断"容器是真活着还是假活着"的可靠办法**：别信 `State`/`Status`，**看端口**。

```powershell
# 通过极空间中转测端口（本机不在同一网段时，这是唯一可行的办法，需要极空间会话 cookie）
curl.exe -s -o NUL -w "%{http_code}" https://remote-access-19388.zconnect.cn/
#   302 = 活（稳定入口正常跳转）   502 = 后端不接连接
```

或者看**容器自己写的日志文件的 mtime**——比任何状态字段都诚实：

```
home:docker/dsh/home/container.log   →   mtime 停在很久以前 = 里面的进程早就死了
```

### 3.8.1 补正（2026-10-18）：`system_restart` 救不了 containerd，只有整机重启能救

上面那套恢复流程**这一次失效了**。同日实测的完整经过：

1. 我为迁移工作区去停 `zspace-dsh`，`container_op?action=stop` 返回 200，
   但容器**半死**（进程没了、dockerd 仍报 running），随后 `container_op` 的
   `start` / `restart` **全部**报 `dial unix:///run/containerd/containerd.sock: timeout`。
2. `POST /zdocker/system_restart` 试了 **4 次**：每次返回 200，一次也没救活。
   **原因：它重启的是 dockerd，不动 containerd。**
3. `/zdocker/system_switch?status=off|on`（Docker 服务开关）也试了：
   `status` 4 秒就切回 on，是极空间的管理开关，**同样不重启 containerd**。
4. 拿最小容器 `appstore_ddns-go` 验证 → 同样失败（它报的是另一个错
   `driver failed programming external connectivity`，说明**网络层也坏了**）。
5. **最后靠整机重启解决**：`POST /system/reboot` → 7 分 20 秒后全部容器自动恢复。

#### 关键发现：`/system/reboot` 这个接口

它**不在 `/zdocker` 命名空间下**，所以之前扫 `/zdocker/*` 端点列表时根本不会看到它。
是从**极空间网页端的主 JS** 里挖出来的：

```powershell
# 1) 拿到网页端 HTML，找它引用的 JS
GET http://127.0.0.1:13579/home/            # 桌面客户端网关
# 2) 在 /home/static/js/index.<hash>.js（约 1.5MB）里搜 reboot
#    命中：/system/reboot 、/system/shutdown 、/storagepool/esata/v2/sys/reboot
```

```http
POST /system/reboot            # body 空对象 {} 即可
→ {"code":"200","ts":...,"msg":"200","data":{}}
```

**它不走 Docker**，所以 containerd 坏着也能用 —— 这是目前**唯一能在 API 层修
containerd wedge 的手段**。实测恢复约 7~8 分钟。

> 找这类"系统级"接口的通用办法：**别只在 `/zdocker/*` 里找**，去网页端 JS 里搜。
> 极空间把 Docker 相关接口放 `/zdocker`，把设备/系统相关放 `/system` 等另一套命名空间。

#### 关于 `container_top` 当健康检查：它有陷阱

`container_top` 在**容器本身没运行时**会直接返回 `container <id> is not running`，
**根本不去碰 containerd** —— 所以它报"正常"完全不能证明引擎健康。

**可靠的判据**：看它有没有返回真实的进程列表：

```jsonc
// 健康（containerd 真的在工作）
{"data":{"Processes":[["root","18258","18237","0","22:55","?",...]]}}
// 不健康（wedge）
{"code":"Error response from daemon: ... dial unix:///run/containerd/containerd.sock: timeout"}
```

#### 补正：停容器"必然 wedge"这个结论是错的

同一天晚些时候，同样的 `container_op?action=stop` 在**引擎健康时 4 秒就停好了**，
删除、重建、启动全部顺利（详见 README 第 12 节）。

**正确表述**：**在已经退化的引擎上**，任何 `container_op` 写操作都会撞上 wedge；
引擎健康时它们是安全的。所以"停容器有风险"的真正含义是
**"先确认引擎是健康的，再停"** —— 判据见上一条。


---

## 4. 坑速查表

| 现象 | 根因 | 对策 |
|---|---|---|
| `404 page not found` | 路由不存在 | 名字写错了；别猜，从分片里拿 |
| `{"code":"xxx is empty"}` | 缺参数 | **故意空参调用**，报错会点名缺什么 |
| `/shortcut/*` 返回 200 但字段是空 | 用了 JSON | 改**表单编码** |
| `invalid reference format` | `image_pull` 少了 `image_tag` | 两个参数都要传 |
| 拉的不是指定 tag | `image_tag` 被忽略 | 目前只能拉 latest |
| 搜不到镜像 | 搜索只匹配仓库名 | 只输仓库名（`node`），别带 `:tag` |
| 卷挂载后容器起不来 | Binds 用了 `/sata1/my/...` | 换成 `/tmp/zfsv3/sata1/<用户>/...` |
| `container_info` 说参数空 | 参数名是 `container_id` | 别传 `id` |
| 网页端一直掉登录 | 没勾「保持自动登录」 | 登录时勾上 |
| 网页端 API 报 `token已失效` | 直接把账号 token 塞 cookie | 走完整登录流程拿会话 cookie |
| 局域网 IP 拿不到 | 没有对应 API | 容器用 `host` 网络，让服务自己 `networkInterfaces()` 读 |
| `/kv/*` 报 `N150005 k参数不合法` | 用了 JSON | **`/kv/*` 也要表单编码**（和 `/shortcut/*` 一样，见 §3.7） |

---

## 5. 复现脚本

`tools/` 目录下：

| 文件 | 用途 |
|---|---|
| `zs-docker-api.js` | 极空间 Docker API 客户端（用浏览器导出的 cookie） |
| `zs-rm.js` | 通过文件 API 删除 NAS 上的文件 |
| `zs-gateway.js` | 经本地网关抓 NAS 网页端任意路径（探测用） |
| `asar-extract.js` | 从客户端 `app.asar` 提取文件（逆向用） |
| `ctxgrep.js` | 压缩单行 bundle 的上下文 grep（逆向用） |

用法：

```bash
node tools/zs-docker-api.js /zdocker/system_info
node tools/zs-docker-api.js /zdocker/v2/container_list POST '{}'
```

## 6. 未验证 / 待补

1. `/shortcut/deletedockershortcut` 的参数形状（试过 `id`/`ids`/表单，均报 `N001212 参数有误`）
2. `/zrps/api/remoteaccess/add` 的请求体（远程访问，需从 remoteAccess 子窗口的分片里挖）
3. `/kv/load` 的 key 命名规则（`{k:"remoteAccess"}` 报 `N150005 k参数不合法`）
4. `image_pull` 精确 tag 的正确参数名
5. 应用商店 `/AppStore/v1/pkg/install` 的完整参数
