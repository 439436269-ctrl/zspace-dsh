# 把 DeepSeek Harness 装进极空间 NAS：一份带代价的部署记录

## 一、为什么要把一个会执行命令的 agent 放到 NAS 上

我要的不是多一个服务，而是三件事：**常开**（会话有状态，PC 一关就断，NAS 本来就 7×24）、**手机和电脑同一套环境**（同一工作区、会话和配置）、**不用额外买机器或开云主机**（存储和备份本来就有，工作区原地就在备份里）。

代价先说：这台是极空间 Z4S（N6005 / N5105，15.42 GiB 内存），纯 CPU，能跑 agent 编排，**跑不了给 agent 用的本地模型**——MiMo 9B 实测 0.024 tok/s，而 DSH 一轮提示词 6627 token，所以是「NAS 当壳，模型走 API」。

另一条路是把 DSH 留在 PC 上、NAS 只当访问通道：原有的工作目录、skill 库、git 凭据都在，但 PC 一关就没了。我要的是常开，所以没选。

## 二、最终形态：一个容器、三个端口、四个挂载

| 项 | 值 |
|---|---|
| 容器名 | `zspace-dsh` |
| 镜像 | `node:latest`（Debian 版，1189 MB） |
| 网络 | `host` |
| 重启策略 | `always` |
| 启动命令 | `bash /dsh/conf/entrypoint.sh` |
| DSH 版本 | `0.2.0-rc.2`（`@deepseek-ai/dsh`） |

三个端口，**只有 19388 是给人用的**：

| 端口 | 是什么 | 要不要 token |
|---|---|---|
| `19387` | DSH 本体，`dsh web` 真正监听的地方 | 要，且每次启动都变 |
| `19388` | 稳定入口反代：读日志拿 token、换 cookie、注入后转发 | 不要 |
| `19389` | HTTP API 桥：把 headless 模式包成普通 HTTP 接口 | 要 `X-API-Key` |

四个挂载都是持久化目录，容器重建不丢：`/dsh/conf`（脚本、`api-key.txt`）、`/dsh/home`（`DSH_HOME`：会话、凭据、profile 补丁层）、`/dsh/npm`（CLI 安装位置）、`/workspace`（agent 工作区）。

host 模式下这三个端口直接绑在 NAS 上，且都监听 `0.0.0.0`——局域网内谁都能访问，这是后面必须给 19389 加 key 的原因。日常维护很轻：升级只改 `DSH_VERSION` 后重启；备份整个 `/dsh/home` 就等于备份了会话、凭据和配置；卸载是删容器再删目录，不碰系统。

极空间特有的坑：**给 dockerd 的路径和文件管理器里看到的不是同一个**。`/sata1/...` 是文件管理器视角，dockerd 只能看到 `/tmp/zfsv3/sata1/...`，`Binds` 必须写后者；两套指向同一份数据，实测写入后回读一致。

## 三、部署主体

### 3.1 先过 DSH 自己那道门

DSH 明确拒绝对外监听，`dsh web --host 0.0.0.0` 会被它怼回来：

> `--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network`

理由是对的：它能执行任意命令，挂到网上就是暴露 RCE。我**不改它的代码**，只在配置层（`--patch`）把 `webserver.host` 写成同一个值，绕过 CLI 守卫——能力可行，风险要自己知情。

这套边界我逐条打过：首页无 token → **401**；带正确 token → **303 + 下发签名 cookie**；`/api/*` 用没声明的 Host → **403**；声明了但没 cookie → **401**。

entrypoint 每次启动生成 `/dsh/home/10-listen.yml`：

```yaml
- id: webserver
  config:
    host: '0.0.0.0'
    port: 19387
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
```

注意 `patch` 对同一插件的 `config` 是**整块替换**，不是深合并，原有键必须写全。

### 3.2 entrypoint 干了什么

脚本只依赖 bash 和 node，不用开 SSH。按顺序：

1. **幂等装 DSH**：比对 `dsh --version` 与目标版本，不一致才装（先 npmmirror，失败回退官方源）。装在挂载卷里，版本不变就不重装。
2. **尝试装 bubblewrap**（Linux 沙箱首选后端），失败只告警——后面会看到这是伏笔。
3. **生成监听覆盖层**并组装 `--trusted-host`，来源是环境变量和 `conf/trusted_hosts.txt`（逐行过滤，非 `host`/`host:port` 形状的 token 直接丢掉）——带 UTF-8 BOM 时，BOM 会被当成一个"地址"，DSH 会因它不是合法 authority 拒绝加载整个插件。
4. **起 `dsh web --no-open`**，stdout 写进 `container.log` 并回显，同时抓 `?token=` 写进 `entry-url.txt`。
5. **起 19388 代理和 19389 桥**，`trap TERM` 时一起收掉。

### 3.3 为什么必须是 host 网络

不是偏好，是被两边的限制夹出来的。极空间建容器默认 bridge；容器里 `networkInterfaces()` 只看到自己的 `172.x`，DSH 拿它推导"局域网可信地址"时**不含极空间的真实 IP**，于是带 `Host: <你的NAS>:19387` 的请求被 `/api` 围栏拒掉，表现为"页面能打开、应用全 403"。

手动填 `DSH_PUBLIC_HOST`？极空间没有可靠接口读自己的局域网 IP（`/network-settings/v1/network/config/show` 只返回 `{"advanced":false}`，客户端的 `nas.nasIp` 也是空的），等于让你猜。

换 `host` 后容器共享 NAS 网络命名空间，DSH 直接读到 NAS 的真实网卡，局域网地址被自动信任，`DSH_PUBLIC_HOST` 可留空；端口就是 NAS 的端口，而远程访问域名是通配的 `remote-access-<端口>.zconnect.cn`，19388 不用单独建条目。代价是**没有端口隔离**：三个端口对局域网直接可达。

### 3.4 复现用的命令

普通 Docker 主机上（注意**没有 `-p`**，host 模式下端口就是宿主机端口）：

```bash
docker run -d --name zspace-dsh \
  --network host \
  --restart always \
  -e TZ=Asia/Shanghai \
  -e DSH_VERSION=0.2.0-rc.2 \
  -e DSH_PORT=19387 \
  -e DSH_PERMISSION_MODE=danger-full-access \
  -v <NAS上的目录>/conf:/dsh/conf \
  -v <NAS上的目录>/home:/dsh/home \
  -v <NAS上的目录>/npm:/dsh/npm \
  -v <NAS上的目录>/workspace:/workspace \
  node:latest \
  bash /dsh/conf/entrypoint.sh
```

在极空间上参数一样，只把 `Binds` 换成 `/tmp/zfsv3/...`。顺带一个接口坑：`image_pull` 会忽略 `image_tag`，传 `node:22-bookworm-slim` 拉回来的仍是 `node:latest`，要精确 tag 只能在界面里拉。

关键环境变量：

| 变量 | 作用 |
|---|---|
| `DSH_VERSION` | 要装的 DSH 版本，升级改这里 |
| `DSH_PORT` | 容器内监听端口；bridge 下必须与端口映射一致 |
| `DSH_PERMISSION_MODE` | 沙箱模式；容器里通常要 `danger-full-access` |
| `DSH_TRUSTED_HOSTS` | 额外信任地址，空格分隔 |
| `DSH_PUBLIC_HOST` | host 网络下可留空 |

## 四、三个必须自己补的组件

### 4.1 稳定入口：把每次都变的 token 挡在门外

DSH 的入口 token **每个进程随机生成**（源码里 `randomBytes(32)`，没有配置项），容器一重启就变；直接发带 token 的地址，几次后全成 401。

`entry-redirect.js` 的做法：每次请求读日志尾部 128 KB，取最后一次出现的 `?token=`（20 字符以上），用它请求 `/?token=…` 换到 `dsh-auth` cookie，缓存 6 小时（DSH 的签名 cookie 本身是 30 天），然后注入 cookie、把 `Host` 改写成 `127.0.0.1:19387`，在 NAS 内部转发；响应里的绝对 `Location` 改写成相对路径，避免浏览器被带去没有隧道的端口。

**为什么不是 302 跳转**：第一版就是跳转，局域网没问题，走极空间客户端隧道时会断。客户端只隧道它那一个本地端口（实测手机上是 `127.0.0.1:20080`），而跳转目标恒为 `:19387`，浏览器于是被带到**客户端设备自己的 19387**：手机是"网页无法打开"，PC 更糟——PC 自己的 DSH 就占着 19387，拿到 401。改成代理后客户端全程只用一个端口。代理起来后会自检一次，日志里 `status=200` 表示拿到的是 DSH 界面；401 说明 token 没换到 cookie。

### 4.2 老浏览器垫片：不是为了兼容，是为了能点开

极空间客户端内置内核比 Chromium 116 老，而 DSH 界面用了 `AbortSignal.any()`。表现不是白屏，是界面能渲染、但一点"选择工作区目录"就红字报 `AbortSignal.any is not a function`。

代理对 HTML 响应注入垫片，插在 `</head>` 之前（找不到就插在 `<body>` 后），保证在应用脚本前执行。补的是同批次常见缺失的一整套：`AbortSignal.any/timeout`、`Object.hasOwn`、`Array/String` 的 `at`/`findLast`/`replaceAll`/`toSorted`、`Promise.withResolvers`、`structuredClone`。新浏览器上全是空操作。

三个实现细节都是踩出来的：**只对 HTML 路径改写**（`/`、`/index.html`、`*.html`），其余流式透传，否则 633 KB 的 JS 也要读进内存；这些路径**去掉 `accept-encoding`** 拿明文；改写后**必须同时删 `content-length` 和 `transfer-encoding`**（还有 `content-encoding`）再重设长度，只删一个会得到 `HPE_INVALID_CONTENT_LENGTH`。

### 4.3 HTTP API 桥：给一个没有 REST 面的东西加 REST

DSH 自身**没有可网络直连的 REST 面**：`/api/*` 全部 404（界面走 WebSocket，路径写死在 `dsh-api-gateway` 的 `/api/remote.mux`）；`--profile sdk` 是 stdio JSON-RPC；`--profile headless` 本来就是一次性 CLI。

所以加了 `dsh-api-bridge.js`（19389），把 `dsh --profile headless --json` 包成 HTTP。选它而不是 sdk：自带 `--session-id`，能续接持久化会话，事件流第一行就给出 `sessionId`，每次调用是独立进程，不用维护常驻连接。`spawn` 还做了三级回退（原样 → 绝对路径 node + 脚本 → PATH 里的 node）：带 shebang 的脚本在解释器不在 PATH 上时，Node 报的是 `ENOENT`，看着像"文件不存在"。

接口很小：`GET /` 是给浏览器看的说明页，`GET /health` 返回诊断，两者无需鉴权；`POST /v1/ask` 要 `X-API-Key`，body 是 `{"task":"…","sessionId":"…"}`；`GET /v1/ask?key=&task=` 等价 POST，供浏览器直测。

密钥放 `conf/api-key.txt`，**桥读文件而不是读环境变量**，轮换密钥不用重建容器。文件缺失或短于 16 字符时**拒绝一切请求**（fail-closed）——这个接口等价于"在你的 NAS 上执行任意 DSH 任务"，裸奔等于把 NAS 交出去。所有请求**串行排队**（DSH 是单 agent），每次请求拉起一个进程、15 分钟超时，没有流式输出，也不是给高并发用的。

bash 用法：

```bash
KEY=$(cat <NAS上的目录>/conf/api-key.txt)

curl -s -X POST http://<你的NAS>:19389/v1/ask \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"task":"只回复两个字：收到"}'
```

PowerShell 版（`KEY=$(cat …)` 在 PowerShell 里不成立，`$KEY` 会是空值，直接 401）：

```powershell
$k = (Get-Content "<NAS上的目录>\conf\api-key.txt" -Raw).Trim()
Invoke-RestMethod -Method Post -Uri "http://<你的NAS>:19389/v1/ask" `
  -Headers @{ "X-API-Key" = $k } -ContentType "application/json; charset=utf-8" `
  -Body ([Text.Encoding]::UTF8.GetBytes('{"task":"只回复两个字：收到"}'))
```

实测：第一轮让它建 `hello-api.txt`，12 秒返回；第二轮带上 `sessionId` 问"刚才那个文件里写的是什么"，10 秒返回正确答案，多轮记忆生效。

### 4.4 这三样都是补丁，不是能力

代理补的是"token 每次变 + 客户端只隧道一个端口"，垫片补的是"客户端内核太老"，桥补的是"没有 REST 面"。它们都工作在 DSH 之外，所以 DSH 升级后要重新验一遍——最可能先坏的就是这三处。

还有一处我绕开的东西：DSH 的网页设置页在非回环地址下**默认不可用**（客户端里是 `remote.$host.isLoopback ? "host" : "memory"`，非回环时不加载设置镜像），所以模型配置走 profile 补丁层 + `$DSH_HOME/.env`。后来我用 profile 遮蔽库存插件，把这个闸门做成显式配置项，设置页才可用——但这绕开的是 DSH 保护凭据的**有意策略**，含义是"任何拿到有效会话的人也能改设置"。对单人 NAS 就是你自己，不过要知道自己在关一个保护。

## 五、四个只有实测才会知道的坑

### 5.1 客户端内核老：`AbortSignal.any is not a function`

**现象**：界面正常渲染，点"选择工作区目录"红字报错。**根因**：客户端内核低于 Chromium 116，没有 `AbortSignal.any`。**修法**：注入垫片，见 4.2。

### 5.2 改了 Host 没改 Origin：界面永远在「正在加载模型…」

**现象**：页面能开、模型列表也出来了，但永远转圈显示"正在加载模型…"；中转看到的是 502，代理日志里没有 `ws upgraded`。

**根因**：DSH 的界面取数据不走 REST，走 WebSocket `/api/remote.mux`，这条断了界面就是永远转圈。代理为绕开 Host 围栏把 `Host` 改写成了 `127.0.0.1:19387`，但浏览器的 `Origin` 还是 `https://remote-access-19388.zconnect.cn`。**两者不一致，DSH 判成跨源**，拒绝 WebSocket 升级（HTTP 400，中转再包成 502）。

**修法**：`Origin` 跟着 `Host` 一起改写：

```js
if (h.origin) h.origin = `http://${TARGET_HOST}:${TARGET_PORT}`;
```

**反直觉的点**：把 19388 的域名加进 `--trusted-host` **不管用**，实测加了仍然 502。白名单管的是 Host 围栏，跨源检查是另一件事。

### 5.3 `container_op` 是 GET；而 `system_restart` 救不了 containerd

**现象**：容器列表显示 `running` / `Up N hours`，但端口 502；`container_top` 报 `dial unix:///run/containerd/containerd.sock: timeout`；`container_op` 的 start/stop/restart 返回 `{"code":"200","data":null}` 但完全不生效。

**根因**：**containerd 挂了**。dockerd 还能读写自己的元数据（所以列表看着正常），但所有容器生命周期操作都要经 containerd，于是全部失效——包括"只重启某一个容器"这件事，此时根本不存在。排除项也都试过：磁盘没满（26.5 GB 已用，存储池剩 12.7 TB）、dockerd 活着（`system_info.SystemTime` 是当前时间）、同一中转下其他端口正常。

**方法上的坑**：`/zdocker/container_op` 是 **GET**，传 POST 一律 404；`/zdocker/system_restart` 反而是 **POST**。我图省事用默认 GET，发成 GET → 404 → 误判"接口失效"，白跑两轮。**先确认方法，再怀疑接口**。

**修法**：`system_restart` 只重启 dockerd，**不动 containerd**，所以无效；`system_switch` 同样无效。唯一能救的是整机重启：

```bash
# 极空间没有 docker CLI，这些请求要经桌面客户端网关并带网页端会话 cookie
curl -s -b cookie.txt "http://127.0.0.1:13579/zdocker/container_op?container_id=<容器ID>&action=stop"

curl -s -b cookie.txt -X POST "http://127.0.0.1:13579/zdocker/system_restart" -d '{}'

curl -s -b cookie.txt -X POST "http://127.0.0.1:13579/system/reboot" -d '{}'
```

`/system/reboot` **不在 `/zdocker` 命名空间下**，扫 Docker 端点列表根本看不到。它是从极空间网页端主 JS（约 1.5 MB 的 `index.<hash>.js`）里搜 `reboot` 搜出来的，同批还命中 `/system/shutdown`。它不走 Docker，所以 containerd 坏着也能用，恢复约 7~8 分钟。

### 5.4 容器里的 agent 一条命令都执行不了

**现象**：通过 19389 让容器里的 DSH 跑安装脚本，两次都拒绝：

```
Error: sandbox mode "workspace-write" is requested but no sandbox backend is usable
on this host; refusing to run the command unconfined. Install bubblewrap or run a
Landlock-enforcing kernel (Linux), ...

Error: sandbox escalation to "danger-full-access" requires approval,
but no approval channel is available
```

**根因**：`node:latest` 里**没有 bubblewrap**，宿主内核**也没启用 Landlock**——`workspace-write` 要求的后端不可用，连 `ls` 都起不来；唯一能绕开的 `danger-full-access` 需要审批通道，网页/API 会话里没有。**默认状态下，容器里的 agent 一条命令都执行不了。**

**第二层坑**：我先在 `extra.patch.yml` 写了 `permission.defaultPreset: danger-full-access`，日志确认补丁加载了，**但 agent 报的还是 workspace-write**。因为环境变量 `DSH_PERMISSION_MODE=workspace-write` **优先级更高**——配置层级是 bundle → profile 补丁 → `$DSH_HOME` 补丁 → `--patch`，但环境变量在最外层。

**修法**：改环境变量并重建容器，不是改补丁：

```
DSH_PERMISSION_MODE=danger-full-access
```

它配的是 `approval: never`，不需要审批通道。**代价**是允许容器里的 DSH 执行任意命令；这只影响容器内部，真正要命的是 `conf/api-key.txt`——那把 key 本来就能驱动任意任务。

## 六、一次真实事故：为了迁工作区，把服务停了三个小时

2026-10-18 下午，我要把工作区从个人空间迁到「团队空间/公共分组」。Docker 不能给运行中的容器加挂载，只能停、删、按新 `Binds` 重建。流程没错，错在时机：引擎此前已连续重启过 4 次，处于退化状态，而我没有任何可靠判据就执行了 `action=stop`。我当时的"检查"是 `container_top`——它在**容器没运行时**直接返回 `not running`，**根本不去碰 containerd**。

排除过程：`stop` 返回 200 但容器半死（进程没了，dockerd 仍报 running）；`start`/`restart` 全部报 containerd socket timeout；`system_restart` 试了 **4 次**、每次 200 都没救活（它重启的是 dockerd）；最小容器 `appstore_ddns-go` 也起不来，报 `driver failed programming external connectivity`——**网络层也坏了**。最后 `POST /system/reboot`，**7 分 20 秒**后全部容器按 restart 策略恢复。

**代价**：中断约 **3 小时**；整机重启把所有 `restart: always` 的容器一起拉起，**包括我之前手动停掉的**（`mimo-llm`、`appstore_openclaw`、`appstore_siyuan`）。

**后续对照**：当晚引擎干净时同样的操作——停 4 秒、删 6 秒、建 2 秒、启动到 200 共 **156 秒**。所以结论不是"停容器有风险"，而是：**写操作在引擎健康时是安全的；"停容器有风险"的准确含义是"先确认引擎健康，再停"。**

## 七、事后回看：三条方法论

**一、"看不到成功日志"不等于"请求没到"。** 排查 WebSocket 时，日志里没有 `ws upgraded`，我据此断言"中转不透传 WebSocket"，白绕一轮。真相是处理器内部失败时同样不写成功日志；加上入口日志（收到的请求、上游状态码、错误码）后，**5 分钟**定位到 Origin 跨源。缺日志是缺证据，不是有反证。

**二、`api.github.com` 通不等于 `github.com` 通。** 我拿 API 的可达性推断仓库的可达性，先怀疑凭据、再怀疑权限，最后发现 `github.com` 只是**慢**（约 8 秒），探活超时设 12 秒就会误判。不同入口要分开探。

**三、先探、再问、最后才动手。** 判断引擎健不健康，别看会在容器未运行时短路的 `container_top`，要看它有没有**返回真实进程列表**：

```jsonc
// 健康：真的拿到了进程
{"data":{"Processes":[["root","18258","18237","0","22:55","?",...]]}}
// wedge：containerd 已经不响应
{"code":"Error response from daemon: ... dial unix:///run/containerd/containerd.sock: timeout"}
```

同一原则也适用于接口：先确认方法（GET 还是 POST），再怀疑接口。

## 八、附：把这些运维动作收进插件

这些"停容器前先看引擎"的动作，后来收敛成插件 `dsh-zspace@0.4.0`，6 个工具：

`zspace_docker_list` / `zspace_docker_inspect` / `zspace_docker_logs` / `zspace_docker_op` / `zspace_docker_health` / `zspace_system_reboot`

`zspace_docker_health` 是 5.3 那条判据的固化：`container_top` 返回真实进程列表才报 `healthy`，并把 `containerd-wedged` / `container-not-running` / `service-off` 分开报——"探针容器没在跑"和"引擎坏了"是两回事。`zspace_docker_op` 的 remove 和 `zspace_system_reboot` 都强制 `confirm`。

做成插件而不是留在脚本里：极空间没有 exec 接口，容器建好之后所有运维只能走 HTTP API，而 API 的方法、路径、参数名极不统一（`container_op` 是 GET，`system_restart` 是 POST，`/system/reboot` 在另一个命名空间）。`list` 找名字、`inspect` 留底、`logs` 取证，正好覆盖每次排障的前三步。

- npm：<https://www.npmjs.com/package/dsh-zspace>
- 插件仓库：<https://github.com/439436269-ctrl/dsh-zspace>
- 部署手册与逆向文档：<https://github.com/439436269-ctrl/zspace-dsh>

最后一句实话：这套东西的价值不在优雅，它是 workaround 叠出来的——绕开"不许对外监听"的配置覆盖、绕开"token 每次都变"的代理、绕开老内核的注入、绕开"没有 REST 面"的 CLI 包装。它能用，是因为每层都试过、每处失败都留下了记录；它也会坏，坏的时候多半是 containerd，而不是 DSH。
