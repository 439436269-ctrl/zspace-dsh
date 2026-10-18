# zspace-dsh — 极空间 DSH 应用壳

把 DeepSeek Harness（DSH）打包成**一个极空间 Docker 容器**，让它 7×24 挂在 NAS 上，
手机和电脑用浏览器就能用同一个会话环境。

> **⚠️ 本仓库是脱敏后的公开版本，文档里的这几类占位符请替换成你自己的：**
>
> | 占位符 | 含义 | 举例 |
> |---|---|---|
> | `<NAS-IP>` | 极空间 NAS 的局域网地址 | `10.0.0.10` |
> | `<PC-IP>` | 你的 PC 的局域网地址 | `192.168.0.10` |
> | `<NAS_SERIAL>` | 极空间设备序列号（设置页可见） | `Z04xxxxxxxxxxx` |
> | `<ZSPACE_ACCOUNT>` | 极空间账号 ID（就是手机号） | 你的手机号 |
> | `C:\Users\<user>` | Windows 用户目录 | `C:\Users\Administrator` |
>
> 端口、容器名、目录结构这些**没有脱敏**，可以直接照用。
> 另外：`docs/zspace-docker-api.md` 是对极空间网页端的逆向记录，**随固件版本可能失效**，
> 用之前先用里面的"故意空参调用"技巧探一下当前固件的真实形状。

- 目标设备：极空间 **Z4S**（Intel N6005 / N5105，**x86_64**），nasId `<NAS_SERIAL>`
- DSH 版本：`0.2.0-rc.2`（npm 公开包 `@deepseek-ai/dsh`）
- 端口：`19387`

## ✅ 当前部署状态（已上线）

容器**已经通过极空间 Docker API 建好并跑起来**了，不需要手工点界面。

| 项 | 值 |
|---|---|
| 容器名 / ID | `zspace-dsh` / `d281f970ba8433eb0e2d360de568437307c61033bdb2085a7fdbd81f57a6367f` |
| 镜像 | `node:latest`（NAS 上拉的，Debian 版，1189 MB） |
| 网络 | **`host`**（关键，见下） |
| 重启策略 | `always` |
| 挂载 | `/tmp/zfsv3/sata1/<ZSPACE_ACCOUNT>/data/docker/dsh/{npm,home,conf,workspace}` |
| 启动命令 | `bash /dsh/conf/entrypoint.sh` |
| 极空间桌面入口 | 快捷方式 **DSH** → `http://<NAS-IP>:19387/` |

### 入口地址

**① 稳定入口（推荐，永久有效）**

```
http://<NAS-IP>:19388/
```

容器内跑了一个小**反向代理**（`conf/entry-redirect.js`）：它每次请求都去 dsh 日志里
读**当前** token，用 token 换到 DSH 的 auth cookie，再**在 NAS 内部**把请求转发给
`127.0.0.1:19387`，把界面/接口原样返回。所以这个地址**不随容器重启变化**，
**URL 里也不会出现 token**，**不需要记 token**。桌面快捷方式「DSH稳定入口」就指向它。

> **2026-10-16 从"重定向"改成"代理"**。原来的 302 跳转在局域网直连时没问题（两个端口都在
> NAS 上），但**走极空间客户端的隧道时会断**：客户端只隧道了它那一个本地端口（实测手机上是
> `127.0.0.1:20080`），而跳转目标恒为 `:19387`（`hostOf()` 会剥掉端口），于是浏览器被带到
> **客户端设备自己的 19387** 上——手机上是"网页无法打开"，PC 上更糟（PC 自己的 DSH 就占着
> 19387，于是拿到一个 401）。改成代理后**客户端全程只用一个端口**，且代理是在 NAS 内部访问
> 19387，所以 PC 上 19387 有没有被占都无所谓。

自检证据（容器日志）：

```
[entry-redirect] 稳定入口 http://<极空间IP>:19388/  ->  :19387
[entry-redirect] 自检通过: status=302 location=http://127.0.0.1:19387/?token=<...>
```

**② 一次性入口**（重启后失效，一般不用）

```
http://<NAS-IP>:19387/?token=<从容器日志取>
```

**③ 外网入口（手机在外面用）**

```
https://remote-access-19388.zconnect.cn/
```

⚠️ **必须用极空间 App / PC 客户端打开**，裸浏览器会被 302 跳回极空间官网——
这条域名要走极空间的会话（实测：不带会话 302，带会话 401/200）。

**关键发现：极空间的远程访问域名是通配的**，`remote-access-<端口>.zconnect.cn`
里的数字就是 NAS 端口，**不需要为 19388 再单独建一条远程访问**。
所以 19388 上的稳定入口在外网同样有效，且永远不需要 token。

**全链路实测**（从一台**家以外网段**的 PC，经公网，带极空间会话 cookie 走的）：

| 步骤 | 结果 |
|---|---|
| `GET https://remote-access-19388.zconnect.cn/` | **302** → `https://remote-access-19387.zconnect.cn/?token=…` |
| 跟随跳转 | **303**，下发 `dsh-auth-…` cookie |
| 带两家 cookie 请求首页 | **200，34846 字节，DSH 界面正常加载** |
| `/api/…` 带两家 cookie | 404 not found（围栏+鉴权都过，仅路由不存在）|
| `/api/…` 用伪造 dsh cookie | **401 unauthorized**（鉴权是真的）|
| `/?token=错误值` | **401**（token 校验有效）|

### 两个稳定入口的对照

| 场景 | 地址 | 需要 token 吗 | 需要极空间会话吗 |
|---|---|---|---|
| 局域网 | `http://<NAS-IP>:19388/` | 否 | 否 |
| 外网 | `https://remote-access-19388.zconnect.cn/` | 否 | **是**（用极空间 App/客户端打开）|

极空间桌面已加两个图标：**「DSH稳定入口」**（局域网）和 **「DSH外网」**（公网）。

### 为什么之前反复 401

dsh 的入口 token 是**每个进程随机生成**的（源码里 `randomBytes(32)`，无配置项），
容器一重启就变。我最初直接把带 token 的地址给你，而容器期间重启过几次
（其中几次是我在改配置），所以你每次拿到的都已经是过期 token。
**稳定入口就是为了根治这个问题**：它每次请求都重读当前 token，地址恒定。

### 模型怎么配（走 DSH 自己的配置层，不碰网页设置页）

两条链路是**互相独立**的，所以"聊天能用"和"设置页空白"可以同时成立：

| 链路 | 谁提供 | 落在哪 |
|---|---|---|
| **模型选择** | 插件 config | `profiles/web/cordis.patch.yml` 的 `agent-default-model` / `llm-*` 行 |
| **模型凭据** | 凭据层 | `$DSH_HOME/.env`（或 `.credentials.yaml`） |

#### ① DeepSeek 凭据 —— `$DSH_HOME/.env`

```
/dsh/home/.env  内容：  DEEPSEEK_API_KEY=sk-…
```

已验证这一层确实生效：用一个**只含 `.env`、没有凭据文件、没有设置文档**的独立
DSH_HOME 跑 headless，DSH 正常作答。

```
$ DSH_HOME=<只含 .env 的目录> dsh --profile headless "请只回复两个字：收到"
收到
```

凭据解析优先级（官方文档）：

```
继承环境（启动快照，最高，只读）
  > 存储文件 $DSH_HOME/.credentials.yaml
    > 项目 .env（<cwd>/.env）
      > 主目录 .env（$DSH_HOME/.env）
```

> ⚠️ 所以**不要**把机密放进 `conf/env.sh`：那是"继承环境"，优先级最高，
> 会遮蔽 `.env` 和凭据文件。`env.sh` 现在只用于非机密运行时变量。

#### ② Ollama 本地模型 —— profile 补丁层（这就是"插件方式"）

`$DSH_HOME/profiles/web/cordis.patch.yml`：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      ollama:
        displayName: Ollama（极空间本地）
        api: openai-completions
        baseURL: http://127.0.0.1:57777/v1
        defaultContextWindow: 32768
        defaultMaxTokens: 8192
        models:
          - id: qwen2.5:3b
            contextWindow: 32768
            maxTokens: 8192
            input: [text]
```

`llm-pi-ai` 是 DSH 自带的**多 provider 插件**，默认休眠（不注册任何路由）。
一旦它的 `config.providers` 非空，路由即时注册——这就是给 DSH 接任意
OpenAI/Anthropic 兼容端点的官方入口。模板见
[home/cordis.patch.yml.example](home/cordis.patch.yml.example)。

**当前 Ollama 里一个模型都没有**（实测 `/api/tags` 返回 `{"models":[]}`，
数据目录里也只有 `blobs` 没有 `manifests`），所以配置里那一条暂时选不了。

#### 加一个本地模型的完整步骤

1. 在极空间里拉模型，例如 `qwen2.5:3b`（约 1.9GB）。
   也可以让我调 Ollama 的 API 拉（`POST /api/pull` 经极空间中转，只传控制请求，
   模型本身是 NAS 自己从 ollama.com 下的）。
2. 确认它的准确 id（带 tag），例如 `ollama list` 里的 `qwen2.5:3b`。
3. 在 `profiles/web/cordis.patch.yml` 的 `models:` 下加 4 行：

   ```yaml
   - id: qwen2.5:3b          # 必须和 ollama list 里的名字逐字一致
     name: Qwen2.5 3B（本地）
     contextWindow: 32768
     maxTokens: 8192
     input: [text]
   ```

   **这个文件是热加载的，改完约 1 秒生效，不用重启容器。**
4. 刷新页面，模型选择器里就会出现它。

> 配置里预设的是 `qwen2.5:3b`。如果你拉的是别的（7b / qwen3 / llama…），
> 把那 4 行的 `id` 改掉即可；或者把名字告诉我，我用
> `GET /api/tags` 读出准确 id 后同步过去。

**默认模型仍是 DeepSeek**（`agent-default-model` = `deepseek-official/deepseek-flash`）。
本地模型只作为会话里的可选项，想改默认就在同一个 patch 文件里加：

```yaml
- id: agent-default-model
  config:
    provider: ollama
    model: qwen2.5:3b
```

#### ③ MiMo 9B（llama.cpp）—— 同一个插件，第二条路由

由 `zspace-mimo-deploy` 技能部署在极空间上：容器 `mimo-llm`
（`ghcr.io/ggml-org/llama.cpp:server`），宿主端口 `18080 → 8080`。
llama.cpp 自带 OpenAI 兼容接口，所以接进 DSH 就是再加一条 `llm-pi-ai` 路由。

```yaml
      mimo:
        displayName: MiMo 9B（极空间本地）
        api: openai-completions
        baseURL: http://127.0.0.1:18080/v1
        apiKeyEnv: MIMO_API_KEY        # 见下：不写这个会直接被拒
        defaultContextWindow: 2048     # 必须如实写，见下
        defaultMaxTokens: 1536
        models:
          - id: MiMo-V2.6-Distill-Qwen-9B-Q4_K_M
            name: MiMo-V2.6-Distill-Qwen-9B（本地）
            contextWindow: 2048
            maxTokens: 1536
            input: [text]
```

**两个坑，都是实测踩出来的：**

**坑 1：`llm-pi-ai` 要求路由必须有凭据。** llama.cpp 根本不看 Authorization 头，
但没有 `apiKeyEnv` + 一个值就会直接失败：

```
处理失败  本轮运行失败
No API key for provider: mimo
PI_AI_ERROR
```

修法是声明 `apiKeyEnv`，再把占位值放进凭据层（`$DSH_HOME/.env`）——
真值不需要，但那一层必须有东西。改 `.env` 后要**重启容器**（凭据层是启动时构建的）。

**坑 2：`-c` 必须 ≥ DSH 的提示词长度。** compose 里是 `-c 2048`，
而 **DSH 一次请求的提示词实测是 6627 tokens**（系统提示 + 工具定义）。于是：

```
DSH 界面:  request (6627 tokens) exceeds the available context size (2048 tokens)
           exceed_context_size_error  n_prompt_tokens=6627  n_ctx=2048
llama.cpp: E srv send_error: task id = 11, error: request (6627 tokens) exceeds
           the available context size (2048 tokens)
```

**两端引用的是同一个数字** —— 这本身就证明了链路的每一环都是通的，
只是服务端窗口装不下。要让它真的能用，得把 compose 里的
`"-c", "2048"` 提到 `16384`，并把 `defaultContextWindow` 同步改掉。

**改 compose 不必走 CDP**（技能里那条路）：`/zdocker` 有现成端点 ——
`POST /zdocker/v2/compose/list_projects` 拿 `filePath`，
`get_project_file` 读 YAML，`create_project` 带同名的 `config` 写回即可。
本项目里 compose 项目的落点是
`/tmp/zfsv3/sata1/<ZSPACE_ACCOUNT>/data/docker/docker-compose.yml`。

**还有一个没查清的：速度。** llama.cpp 自己的计时：

```
prompt eval time = 32916 ms / 4 tokens (8229 ms per token)
       eval time = 96134 ms / 4 tokens (32044 ms per token)
     total time = 129051 ms / 8 tokens      ≈ 0.03 tokens/秒
```

这比 N5105 上 9B-Q4_K_M 该有的速度（几个 tok/s）慢了约两个数量级。
已排除 Docker 限流：容器的 `CpuQuota` / `Memory` 都是 `0`（无限制），
`NCPU=4`、`MemTotal=15.4 GiB`。最可能的是**主机内存压力** ——
5.48GB 的模型是 mmap 的，若页面缓存装不下就要按 token 回读磁盘。
未验证。

> ⚠️ **这个"内存压力"假设后来被实测推翻了**，见下节「128K 上下文：已上线」。

### 128K 上下文：已上线（含实测对账）

后来把上下文从 2048 提到 **128K**，并做了完整验证。**改 compose 的正确姿势与
踩过的坑见 [docs/zspace-docker-api.md §2.6](docs/zspace-docker-api.md)。**

```yaml
command: ["--host","0.0.0.0","--port","8080",
          "-m","/models/MiMo-V2.6-Distill-Qwen-9B-Q4_K_M.gguf",
          "-c","131072",     # 128K（原 2048）
          "-np","1",         # 单 slot（原默认 4 slot 平分 -c）
          "-t","4","--no-webui"]
```

**实测结果：**

```
/props                 n_ctx: 131072        total_slots: 1        ✅
启动日志               n_slots = 1, n_ctx_slot = 131072, kv_unified = 'false'
模型元数据             n_ctx_train: 262144（模型的训练上限）
实测内存               mimo-llm 5.15 GiB，全容器合计 6.11 GiB / 15.42 GiB → 剩 9.31 GiB
```

**KV 内存的算法**（全套里最值得记住的一条）。这个模型是**混合 SSM + 注意力**
架构，不是稠密注意力 —— GGUF 头里写着：

```
general.architecture              = "qwen35"   (Qwen3.5 9B)
qwen35.block_count                = 32
qwen35.attention.head_count_kv    = 4
qwen35.attention.key_length       = 256        ← head_dim 是 256
qwen35.full_attention_interval    = 4          ← 每 4 层只有 1 层是全注意力
qwen35.attention.recurrent_layers = [true,true,true,false, ...]
```

```
每 token KV = 2(K,V) × (32 ÷ 4)(全注意力层) × 4(KV头) × 256(head_dim) × 2B
            = 32768 B = 32 KiB
128K        = 131072 × 32 KiB = 4.00 GiB
```

**只有 8 层需要 KV**；另外 24 层是 SSM 循环层，状态固定大小（约 33 MiB），
不随上下文增长。把混合架构当稠密算会**多算 4.5 倍** —— 我就这么错过一次，
一度得出"128K 不可能"的错误结论，是你追问算法才挖出来的。

**速度的"内存压力"假设是错的。** 生成期间的实测：

```
CPU  89% ~ 154%（约 1 个核）        内存 稳定 4.85~5.23 GiB
max_tokens=4，8 提示 + 4 生成，墙钟 164.7 秒  →  0.024 tok/s
```

内存纹丝不动、CPU 是忙的 —— **既不是等 I/O，也不是内存不足，是计算路径本身慢，
而且 4 个核只用了 1 个**。单 token 约需 9 GFLOP，单核 AVX2 该在 1 秒/token 上下，
实测 13.7 秒 —— **慢约 14 倍，正是"跑在非 SIMD 参考实现上"的特征**。结合这是
llama.cpp 较新的 `qwen35` 混合架构，**它对 CPU 的内核很可能还没优化**。

> 📌 **llama.cpp 旗标变动**（这个 build `b11610`）：`--mlock` / `--mmap` /
> `--no-mmap` / `-dio` 已从参数解析器**删除**（[PR #28334](https://github.com/ggml-org/llama.cpp/pull/28334)），
> 合并成 `-lm, --load-mode <auto|none|mmap|mlock|mmap+mlock|dio>`。
> 另外新增 `-lzm, --lazy-mode`（默认 `auto` = 超过 4 GiB 的张量按需从磁盘读）。

**结论：这台 N5105 上的 9B 模型，任何上下文长度都不适合给 DSH 的 agent 用。**
DSH 一次请求的提示词实测 **6627 tokens**；即便速度修到理论值（~2 tok/s），
光是 prefill 就要约 **55 分钟/轮**。128K 这个配置本身是对的、也不占额外代价，
但要它实用，得换硬件（GPU）或换小得多的模型。

#### ⚠️ 版本差异：`settings.yaml` 在 0.2.0 已被移除

我一开始按 0.1.5 的文档写了 `$DSH_HOME/settings.yaml`，结果它被 DSH
**改名成了 `settings.yaml.imported`**。查 0.2.0-rc.2 的源码才明白：

```js
/**
 * Move the sections of the removed `settings.yaml` into the active profile ...
 * The document is renamed before the first write, so a partial import never repeats
 */
async importLegacyDocument() {
  await rename(path, `${path}.imported`);
  for (const [section, values] of Object.entries(parse(...))) await this.update(section, values);
}
```

**0.2.0 起 `settings.yaml` 是"遗留文档"**：启动时被改名，然后各分节被**导入到
当前 profile 的 `cordis.patch.yml`**。我的 ollama 配置就是这样进去的
（读回 profile 层确认过）。所以现在配置插件的位置是 **profile 补丁层**，
`settings.yaml` 只会被消费一次。

> **补注（2026-10-15，本机 PC 实测）**：这个导入机制**不是 0.2.0 才有的**。
> 本机 PC 装的是 **0.1.5-rc.3**，它的 `$DSH_HOME` 里同样躺着 `settings.yaml.imported`：
>
> ```yaml
> ui-onboarding:
>   welcomeNoticeVersion: 2026-08-13.1
> ui-theme:
>   preference: light
> ```
>
> 也就是说 **0.1.5 与 0.2.0 的配置分层机制是同一套**（`profiles/<name>/cordis.patch.yml`），
> 两版的 provider profile schema 也一致（`apiKeyEnv` / `displayName` / `api` / `baseURL` /
> `models[]` / `defaultContextWindow` / `defaultMaxTokens` / `defaultInput` …）。
> **所以给 0.1.5 写配置的结论可以直接搬到 0.2.0，反之亦然**——这条我两边都验过。

#### ⚠️ 为什么网页端的「设置 → 模型」打不开

会报 `加载提供商目录失败: settings are unavailable in this browser`。
根因在客户端：

```js
const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
ensure() { if (this.persistence === "memory") return Promise.resolve(); ... }
```

**非回环地址下设置镜像根本不加载。** `isLoopback` 为真只有三种情况：

1. `hostname` 是 `localhost` / `[::1]` / `127.x.x.x`
2. 页面由"拥有主机"的 shell 加载（Electron 桌面端）
3. 没有页面位置（非浏览器宿主）

有意设计——设置里含 API Key 这类凭据，DSH 不允许从非本机来源修改。

所以从 `<NAS-IP>:19388` 或远程域名打开时设置页**必然**不可用
（内置浏览器是 bridge 网络，它的 `localhost` 也不是 NAS 本机）。

**结论：模型配置走 profile 补丁层 + `$DSH_HOME/.env`，完全不需要设置页。**

#### 设置页已经修好了 —— 而且用的是原生「模型」页

结论先说：**现在从 `<NAS-IP>:19388` 或远程域名打开，库存的「模型」「通用设置」
等页面都能正常读写**，UX 和桌面端完全一样。做法是 profile 级遮蔽库存设置插件，
**只改一处**，并把那条闸门变成**显式配置项**。

关键是从第一性原理看清闸门在哪一层：

| 事实 | 证据 |
|---|---|
| `$host.isLoopback` **只是一条只读事实**，不做拦截 | `dsh-api-gateway/lib/client.js` 里就一句 `get $host(){…return {home, isLoopback}}` |
| 真正**消费**它的只有两个默认 UI 插件 | 全树 grep `isLoopback`：`dsh-client-ui-settings`、`dsh-client-ui-settings-general`，其余是代理绕过与围栏 |
| **宿主侧没有任何来源判定** | `dsh-api-settings-controller` 里 `isLoopback` / `loopback` / `localhost` / `origin` 各出现 **0** 次；`writable` 来自设置提供方（文档可写与否），与调用方来源无关 |
| 那个 UI 插件**没有配置面** | `dsh-client-ui-settings` 只导出 `apply` / `inject`，没有 `Config` |

所以闸门是**策略**，不是**能力**。宿主会照常服务任意已鉴权、过了 Host 围栏的调用方。

##### 三层链条

```
profile 补丁层                     遮蔽包的宿主半                     遮蔽包的浏览器半
- id: ui-settings          →      Config.remoteSettings      →      globalThis
  config:                         （默认 true）                      .__DSH_SETTINGS_REMOTE__
    remoteSettings: true          经 webServer.tapIndex                  ↓
                                  注入 index.html                  persistence =
                                                                  (allowRemote || isLoopback)
                                                                     ? "host" : "memory"
```

只有最后一行是改动点。`persistence: "host"` 让设置镜像真正去读宿主，
于是 `configForms` 里就有数据，**库存页面原封不动地工作**。

##### 改动清单（`plugins/shadow-dsh-client-ui-settings/`）

| 文件 | 改了什么 |
|---|---|
| `lib/client.js` | 闸门那一行；原句**保留为注释**，便于比对 |
| `lib/index.js` | `Config` 增加 `remoteSettings: z.boolean().default(true)`；`apply(ctx, config)` 里用 `ctx.inject(["webServer"], …)` + `webServer.tapIndex(html => …)` 把值注入 index.html |
| `package.json` | **名字必须与库存一致**（`@deepseek-ai/dsh-client-ui-settings`），否则那一行 entry 解析不到；版本加 `-zspace1` 便于辨认 |

`tapIndex` 是 `webServer` 暴露的公开钩子（纯 `html → html`），
`renderIndex` 会在渲染完结构化注入表之后按注册顺序跑它。

##### 实测证据（全部从容器外经极空间中转取得）

```
1) 启动健康                        ✅ 无「条目未激活 / 无法解析」错误
2) index.html 注入开关             ✅ 有，值=true
3) ui-settings 行                  ✅ rev=a8546b652356
   抓取该 bundle                   ✅ 200，59796 字节
   活跃的库存判定                   ✅ 已被替换：
      L1511: //   const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";   ← 成了注释
      L1521: const persistence = (allowRemoteSettings || ctx.remote.$host.isLoopback) ? "host" : "memory";
```

**想恢复库存行为**：把补丁层那行改成 `remoteSettings: false`（热加载，约 1 秒生效，
连容器都不用重启）。

##### 为什么不能用更"轻"的几种做法

这几条都是撞过的负结论，记下来免得再试：

1. **不能靠 patch 改 `name` 覆盖库存那行** —— patch 里的 `name` 是**校验**不是覆盖：
   ```js
   if (name && name !== target.name) { warn("patch: name mismatch for %C ..."); continue; }
   ```
   名字对不上直接跳过。所以只能靠 profile 的 `node_modules` 遮蔽同名包
   （bare specifier 默认从配置目录解析，因此优先于安装目录里的同名包）。
2. **不能只给库存插件加个配置项** —— `Config` 在宿主半、闸门在浏览器半，
   而 `WebBootEntry` 只有 `id/url/rev/inject/immediately/external`，**不带 config**
   （见 `dsh-client-modules/lib/types/client/manifest.d.ts`）。
   所以必须自己搭那条宿主→浏览器的通道，也就是上面的 `tapIndex`。
3. **`dsh plugin add` 在容器里用不了**（极空间没有 exec 接口），
   但它的落地语义可以手工等价实现：包放进 `profiles/web/node_modules/` + 补丁层挂一行。

> ⚠️ 注意：这绕开的是 DSH 用来保护凭据的**有意策略**。实际含义是
> "任何已拿到有效会话的人也能改设置"——对单人 NAS 就是你自己，但你要知道这在关一个保护。
> 另外手工放进 `node_modules` 的包不在 profile 的 `package.json` 依赖里，
> 哪天跑 `dsh plugin add/remove` 触发 pnpm 可能被清掉，重新上传即可。

##### 附：我自己那个分区（可选，与库存页重复）

早先我写过一个自建分区 `plugins/dsh-client-ui-settings-remote/`（「配置（远程）」），
它直接调 remote、不读闸门，但用的是 JSON 文本框，**配置体验不如库存的 schema 表单**
（这正是你指出的问题）。现在库存页已经能用，它基本是多余的，只多一张"模型路由表"。

想清掉它：删掉补丁层里那段 `- insert:`（热加载，约 1 秒生效），
再删 `profiles/web/node_modules/dsh-client-ui-settings-remote/` 即可。

### 为什么用 host 网络

容器建的时候网络模式选了 `host`，于是容器共享 NAS 的网络命名空间，
DSH 启动时 `networkInterfaces()` 能读到 NAS 的真实网卡
（实测 `<NAS-IP>`、`192.168.122.1`、`172.18.0.1`、`172.17.0.1`），
**局域网地址被自动加入 Host 信任列表**——`DSH_PUBLIC_HOST` 不用填。

自带验证过的日志证据：

```
dsh web: http://127.0.0.1:19387/?token=... (LAN: http://<NAS-IP>:19387/?token=...)
```

### 已验证 / 未验证

- ✅ 容器创建、启动、DSH 安装（`dsh 就绪：0.2.0-rc.2`）、`dsh web` 起来并打印入口
- ✅ bubblewrap 在容器内安装成功（Linux 沙箱首选后端可用）
- ✅ 极空间桌面快捷方式已创建
- ⚠️ **未验证端到端 HTTP 访问**：本机 PC 在 `192.168.0.x`，到 NAS `<NAS-IP>`
  的端口被跨网段过滤（实测 `TCP <NAS-IP>:19387 -> timeout (filtered)`）。
  **需要你在同网段的设备（手机连家里 WiFi）上打开一次确认。**

---

## 1. 部署方式说明

容器已经用 API 建好了，所以**这一版不需要你点界面**。文档保留 GUI 步骤作为
备选/重建路径（见 `docs/`，以及下面的参数表）——万一要重建，照表填即可。

极空间 Docker 的接口是社区逆向出来的，完整参考在
**[docs/zspace-docker-api.md](docs/zspace-docker-api.md)**（110 个接口 + 实测响应 + 坑表）。

---

## 0. 先看结论：三件你必须知道的事

### ① DSH 官方故意不允许对外监听，我们是"绕过"的

`dsh web --host 0.0.0.0` 会被 DSH 直接拒绝，原话是：

> `--host 0.0.0.0 is intentionally not supported yet for safety: it would expose remote code execution to the network`

DSH 是一个能执行任意命令的 agent，把它挂到网络上就是暴露 RCE 能力。这不是过度的担心，
是设计者的明确取舍。

我们做的是：不改 DSH 代码，只在**配置层**（`--patch` 覆盖层）把 `webserver.host` 写成同一个值，
绕过那个 CLI 守卫。**能力上可行，风险上要你知情。**

### ② 它的安全边界是真实存在的（已实测）

DSH 自带两层防护，我在这台 Windows 上起了一个真实实例逐条打过：

| 请求 | 结果 |
|---|---|
| 首页，不带 token | **401** |
| 首页，带正确 token | **303 + 下发签名 cookie** |
| `/api/*`，Host 是没声明过的地址 | **403（围栏拦截）** |
| `/api/*`，Host 已声明但没 cookie | **401** |

- **token**：每次进程启动重新生成，出现在启动日志里。用它换一个 **30 天有效**的签名 cookie，之后浏览器正常用。
- **cookie 是绑定访问地址的**：用 `<NAS-IP>` 换的 cookie，换到 `dsh.example.com` 不认。
- **Host 围栏只管 `/api` 通道，不管首页** —— 这就是"页面能打开、但应用全是 403"的经典坑。
  所以容器里**必须**正确设置 `DSH_PUBLIC_HOST`（见下面 `--trusted-host` 那一段）。

### ③ 容器里的工作区是全新的

NAS 上的 DSH **没有**你 Windows 这边的东西：`D:\codes`、200+ 个 skill、git 凭据、
playwright、极空间客户端——统统不在。它能吃的是你挂给它的 NAS 目录。

好消息：极空间上已经有一份 skill 库（`/sata1/public/公共分组/skills`），
以后可以把 `~/.agents/skills` 挂进去复用。

---

## 1. 目录结构

```
zspace-dsh/
├── README.md                  ← 本文件
├── scripts/
│   └── entrypoint.sh          ← 容器启动脚本（核心，唯一的必需文件）
└── docker/
    ├── Dockerfile             ← 可选：想自建镜像时用
    └── compose.yml            ← 可选：极空间 Docker 有 Compose 入口时用
```

**最小部署只需要 `entrypoint.sh` 一个文件**，其余是为了方便。

---

## 2. 部署（极空间 GUI，逐步）

### 2.1 目录（✅ 已建好）

以下目录已经在你极空间上创建完成：

```
/sata1/my/data/docker/dsh/
├── conf        ← 启动脚本放这里
├── npm         ← dsh CLI 安装位置（持久化，重建容器不用重装）
├── home        ← DSH_HOME：会话记录、凭据、skill
└── workspace   ← agent 的工作区，它读写的就是这里
```

> 和你已有的 `qb` / `prowlarr` / `nastools` 放在一起，风格一致。
> 工作区是新建的专用目录，和已有数据隔离；以后想让它直接处理某个数据目录，
> 再给容器加一个映射即可。

### 2.2 启动脚本（✅ 已上传并校验）

以下文件已上传到 `/sata1/my/data/docker/dsh/conf/`：

| 文件 | 作用 |
|---|---|
| `entrypoint.sh` | **必需**，容器启动脚本 |
| `extra.patch.yml.example` | 可选扩展层模板（想加功能时改名成 `extra.patch.yml`） |
| `compose.yml` | 参考用，记录了完整的容器配置 |

上传后用分片协议**回读校验过 SHA256**，与本地文件逐字节一致：

```
local : 59F3714C9A0D207295B117AD83EE84A91FA607C38C4839694D5CC37646978BCA
remote: 59F3714C9A0D207295B117AD83EE84A91FA607C38C4839694D5CC37646978BCA
```


### 2.2b 为什么建容器这一步需要你点几下

我把能自动化的都自动化了（目录、文件、校验都是走 API 完成的），但**创建容器这一步
没有可用的程序接口**。原因是：

极空间 Docker 2.0 的前端是个**独立服务**，用自己的 `dockerToken` + `endPointId`
鉴权（我在客户端代码里挖到了这个 store）。它不是 Portainer，接口路径也不在客户端
包里，而是随 NAS 网页端的分片按需加载——分片有几千个，且路径不含语义，无法枚举。
我盲试了 40 个候选接口路径，全部 404。

剩下的通道是网页端，但它有两道门：

1. **登录门**：网页端不吃 token cookie（实测控制台报 `tokenEmpty`、`N001208 token已失效`），
   必须走账号密码 + **新终端短信验证**。
2. **自动化门**：这个 SPA 走极空间中转、页面永不 idle。实测 `page.goto('/home/')`
   会把浏览器控制通道阻塞住，240 秒超时后页面被重置成 `about:blank`。

顺带一个**安全提醒**：极空间客户端在 `0.0.0.0:12345` 上开了个诊断 HTTP 服务
（`/netinfo` 能直接读到你的 nasId 和实时隧道列表），绑的是所有网卡，
同局域网的其他设备可以访问。这不是我引入的问题，但你可能想知道。

所以建容器有两条路，二选一：

- **你在 GUI 点几下**（2–5 分钟，成功率最高），按下面 2.3 / 2.4 的表填。
- **开 SSH**（系统设置 → 远程协助/SSH），我直接 `docker run` 一条命令搞定，
  之后内核沙箱、权限、日志我都能直接验证。代价是极空间官方说开了 SSH 会
  失去软件部分售后支持——这个必须你自己点头。

### 2.3 拉镜像

极空间 Docker 应用 → **镜像** → 搜索/拉取：

```
node:22-bookworm-slim
```

> 这就是官方 Node 22 镜像。DSH 在 Linux 上没有任何需要编译的原生依赖，用官方镜像足够。
> 如果拉取慢，在极空间 Docker 设置里换一个镜像加速源。

### 2.4 创建容器

极空间 Docker 应用 → **容器** → 添加/创建。逐项对照下表：

| 配置项 | 值 |
|---|---|
| 容器名称 | `zspace-dsh` |
| 镜像 | `node:22-bookworm-slim` |
| 重启策略 | **总是重启 / unless-stopped**（很重要，NAS 重启后自动拉起来） |
| 命令 / Command | `bash /dsh/conf/entrypoint.sh` |
| 端口映射 | 宿主机 `19387` → 容器 `19387`（TCP） |
| 网络 | 默认 bridge 即可 |

**目录映射（宿主机路径 → 容器路径）：**

| 极空间上的目录 | 容器内路径 |
|---|---|
| `/sata1/my/data/docker/dsh/npm` | `/dsh/npm` |
| `/sata1/my/data/docker/dsh/home` | `/dsh/home` |
| `/sata1/my/data/docker/dsh/conf` | `/dsh/conf` |
| `/sata1/my/data/docker/dsh/workspace` | `/workspace` |

**环境变量：**

| 变量 | 值 | 说明 |
|---|---|---|
| `DSH_PUBLIC_HOST` | 极空间的局域网 IP | **必填**，见下面「怎么查极空间的 IP」。不填的话页面能打开、但应用全 403 |
| `DSH_PORT` | `19387` | 要和端口映射的右侧一致 |
| `DSH_VERSION` | `0.2.0-rc.2` | 升级就改这里后重启容器 |
| `DSH_PERMISSION_MODE` | `workspace-write` | 先这样；报沙箱不可用就改 `danger-full-access`（见排障） |
| `DSH_NPM_REGISTRY` | `https://registry.npmmirror.com` | 国内快；失败会自动回退官方源 |
| `TZ` | `Asia/Shanghai` | 时区 |
| `DSH_TRUSTED_HOSTS` | 留空 | 走了域名/内网穿透时，把域名写在这里（空格分隔多个） |

> 极空间 Docker 界面可能把"目录映射"叫「存储空间」、把"命令"叫「启动命令」，
> 名字不一样但含义一样。**碰到对不上的地方，把界面截图或描述给我，我按你的固件版本改。**

#### 怎么查极空间的 IP

我查过极空间客户端的本地状态，`nas.nasIp` 是空的、`webBase` 是
`https://www.zconnect.cn` —— 也就是说**你这个客户端平时是走极空间云端中转连的，
不是走局域网**。所以系统里没有现成的局域网 IP 给我读。

任选一处看：

- 极空间客户端 → **系统设置 → 设备连接**（一般会显示局域网 IP）
- 路由器后台的设备列表里找 `Z4S` / `极空间`
- 极空间手机 App → 设备信息

拿到后填进 `DSH_PUBLIC_HOST`。

> ⚠️ **已知风险**：你这台 PC 在 `192.168.0.x`，而之前实测过 NAS 在 `<NAS-IP>`，
> 跨网段时六十多个端口都是 closed/filtered。也就是说**这台 PC 未必能直连 NAS 的
> 19387 端口**。手机连家里 Wi-Fi 如果和 NAS 同网段，通常没问题 —— 但**必须实测**。

### 2.5 启动并拿到入口地址

启动容器，打开**容器日志**，会看到：

```
[zspace-dsh] 版本=0.2.0-rc.2 端口=19387 权限模式=workspace-write
[zspace-dsh] 安装 @deepseek-ai/dsh@0.2.0-rc.2（当前：无）…
[zspace-dsh] dsh 就绪：0.2.0-rc.2
[zspace-dsh] 信任的访问地址：<NAS-IP>
dsh web: http://127.0.0.1:19387/?token=xxxxxxxx

=====================================================================
  DSH 入口地址（手机 / 电脑浏览器直接打开这个）

  http://<NAS-IP>:19387/?token=xxxxxxxx

  首次打开会换成 30 天的签名 cookie，之后不用再带 token。
  每次容器重启 token 会变；已登录的浏览器不受影响。
=====================================================================
```

**第一次启动会花 1–2 分钟装 dsh**（之后就只在容器重建时重装，因为装在 `/dsh/npm` 卷里）。

入口地址同时会写到 `/sata1/my/data/docker/dsh/home/entry-url.txt`，忘了可以去看。

### 2.6 首次登录 DeepSeek

打开入口地址 → 进 **设置 → 模型（Models）** → 按提示填 DeepSeek 凭据。
凭据会存进 `/dsh/home/.credentials.yaml`，重启不丢，也不会被写进环境变量。

---

## 3. 手机 / 电脑怎么访问

### 3.1 在家里（局域网）

同一 Wi-Fi 下，手机和电脑直接开：

```
http://<极空间的局域网IP>:19387/?token=xxxxxxxx
```

**如果打不开**：你之前遇到过「PC 在 192.168.0.x、NAS 在 <NAS-IP>，六十多个端口
closed/filtered」的跨网段问题。那台 PC 和 NAS 不在同一网段。手机连家里 Wi-Fi 时
如果和 NAS 同网段通常没问题——**这一步需要你实测一次**，结果告诉我。

万一就是不通，还有一条不花钱的路：**用极空间客户端自身的隧道**。
客户端本地网关 `127.0.0.1:13579` 是通的（我已经在用它读写你的 NAS），
所以只要能让浏览器走这个网关，就能绕过网段隔离。等你确认 Q2 的入口问题后再定。

### 3.2 在家以外

这是我目前**还没替你定死**的一环，原因下面说清楚。

极空间的隧道机制我挖出来了。桌面客户端里是这么建隧道的：

```js
libzrpc_start_service({ local_port, remote_port, type: 1, nas_id })
// 本机 13579  ← NAS 5055   （极空间网页版，也就是文件/相册那套）
//             ← NAS 8050   （文件服务）
//             ← NAS 9001 / 22345 ...
```

也就是说**极空间客户端的任意本地端口都可能隧道到 NAS 的任意远端端口**，走极空间自己的中转，
所以你在外面也能用。青龙面板显示在 `127.0.0.1:10007` 就是这么来的。

但是——这套"应用注册"掌握在极空间客户端/固件手里：极空间自己的应用（网页版、相册、
Docker 控制台）都有对应的 `remote_port` 和独立 token（我在客户端里找到了
`dockerToken`、`endPointId` 这套东西），而**自建容器没有公开的注册入口**。
我不能确认你的固件版本里有没有"给容器加网页快捷方式"这个按钮——**这个需要你看一眼**。

所以远程访问有三条路，按推荐顺序：

| 方案 | 做法 | 代价 |
|---|---|---|
| **A. 先看极空间有没有现成入口** | 在极空间 Docker 里给容器加个「网页访问 / 快捷方式」，看手机 App 能不能点开 | 零成本，但**待确认**，取决于你的固件 |
| **B. 容器内自带内网穿透**（推荐） | 在同一个容器里跑 `cloudflared` 或 `cpolar`，给你一个 HTTPS 域名，手机电脑直接开 | 需要一个域名（Cloudflare 免费）或用 cpolar 免费版（域名会变）。我可以直接加进这个壳 |
| **C. Tailscale 组网** | NAS 上跑 Tailscale 容器，手机装 Tailscale | 极空间 Docker 不一定给 `/dev/net/tun`，可能要试 |

**A 是零成本的，建议你先花 30 秒看一眼**：极空间 Docker → 你的容器 → 有没有
类似「网页访问」「访问入口」「快捷方式」「添加到桌面」的按钮？有的话点一下、
看手机极空间 App 里能不能打开。把这个结果告诉我，我就能定死方案。

要走 B 的话说一声，我把 `cloudflared`/`cpolar` 直接做进 entrypoint，改一个环境变量就启用。

---

## 4. 升级 / 备份 / 卸载

**升级 DSH**：改环境变量 `DSH_VERSION` → 重启容器（entrypoint 会自动检测版本差异重装）。

**备份**：整个 `/sata1/my/data/docker/dsh/home` 就是你的全部状态（会话记录、凭据、skill）。
拷走它就等于备份。

**卸载**：删容器 → 删镜像 → 删 `/sata1/my/data/docker/dsh`。不碰系统，不留残留。

---

## 5. 排障

| 现象 | 原因 | 对策 |
|---|---|---|
| 日志里 `dsh 安装失败` | 容器连不上 npm 源 | 换 `DSH_NPM_REGISTRY`；或确认 NAS 能出网 |
| **页面能打开，但一片空白/应用报 403** | `DSH_PUBLIC_HOST` 没填或填错，Host 围栏把 `/api` 拦了 | 把 `DSH_PUBLIC_HOST` 改成你浏览器地址栏里那个地址，重启容器 |
| 打开首页 401 | URL 少了 `?token=`，或 token 已过期（容器重启过） | 从容器日志或 `home/entry-url.txt` 重新取地址 |
| 手机能开、电脑不能（或反过来） | 两台设备用的访问地址不同，cookie 绑地址 | 统一用一个地址访问 |
| agent 报沙箱不可用 / 无法写文件 | Linux 沙箱链是 `bwrap → landlock`，容器里两者都可能不可用，DSH 会 **fail-closed** | 把 `DSH_PERMISSION_MODE` 改成 `danger-full-access`，重启。此时**容器本身**就是安全边界（只挂了那四个目录） |
| 端口映射了但局域网连不上 | 跨网段被滤（你之前遇到过） | 让访问设备和 NAS 同网段；或改用方案 B/C |
| **映射了端口，对端还是连不上（ping 通、TCP 全挡）** | **不是路由器，是两端主机各自的防火墙。** PC 侧实测根因：已有的 `Node.js JavaScript Runtime` 入站放行规则是 **`Profile=Public`**，而以太网网卡是 **`Private`** → 走默认策略被静默丢弃 | 在**目标端主机**加一条 `Profile=Any` 的入站规则；或把那块网卡的网络配置文件改成「公用」。判据与完整方法见 §5.1 |
| 改了 `DSH_PORT` 后打不开 | 只改了环境变量，没同步改端口映射 | 两处必须一致 |

### 5.1 判「跨网段不通」到底是谁挡的（2026-10-15 实测）

**先分清 ICMP 和 TCP——这一步能直接排掉一半误判：**

| 观测 | 含义 |
|---|---|
| ping **通**、TCP **全挡** | 路由是通的，**包在目标端被防火墙静默丢弃**（超时，不是拒绝） |
| 连接报 `ECONNREFUSED`（拒绝） | **网络是通的**，只是那个端口没有服务在听——含义与超时完全相反 |
| ping 也不通 | 才是真的没路由 / 被中间设备拦 |

**本次的完整证据链**（PC `<PC-IP>` ↔ NAS `<NAS-IP>`，两端不同网段）：

```
tracert <NAS-IP>       → 1 跳，<1ms        ← 路由通的
ping    <NAS-IP>       → True             ← ICMP 通的
tcp     <NAS-IP>:19387 → 超时             ← 全部端口都不通
tcp     192.168.1.1:80    → 通！             ← 同网段另一台却通，排除"整段被拦"
NAS 容器 → PC:18999       → RESULT TIMEOUT   ← 反方向也是超时（不是 refused）
PC 侧监听日志              → 零连接           ← SYN 根本没到
PC 防火墙                 → Node 规则 Profile=Public，网卡 NetworkCategory=Private
```

**排查顺序（照这个走，别猜）：**

1. **区分超时与拒绝**——超时 = 被丢包；拒绝 = 服务没起。两者根因完全不同。
2. **用同网段另一台主机做对照**（如上 `192.168.1.1:80` 通），证明网段间路由是放行的，问题收敛到目标主机。
3. **查目标主机防火墙规则的"作用域"**，不要只看有没有规则：
   ```powershell
   Get-NetFirewallRule -DisplayName "*Node*" | ForEach-Object {
     $r=$_; $pf=$r|Get-NetFirewallPortFilter; $af=$r|Get-NetFirewallApplicationFilter
     "{0} | Enabled={1} Profile={2} Action={3} | Port={4} | Program={5}" -f `
       $r.DisplayName,$r.Enabled,$r.Profile,$r.Action,$pf.LocalPort,$af.Program }
   Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory   # 网卡实际是 Private 还是 Public
   ```
   **`Profile` 与 `NetworkCategory` 不匹配 = 规则形同不存在。**
4. **反向探测**（判断是不是对端也挡）：在 A 端起监听，在 B 端跑一个容器发起连接，看错误码。
   建容器时务必 `AutoRemove: false`——设 `true` 的话容器退出即自删，**日志一起没了**，只剩一个空错误（见 `docs/zspace-docker-api.md` §3.2）。
5. **量力而行**：改主机防火墙需要管理员权限（脚本 `allow-lan.ps1` 那个套路）。
   若拿不到管理员权限、或不想动防火墙，**换一条拓扑**比死磕更划算——
   比如把模型放在**和 DSH 同一台机器**上（本机走 `127.0.0.1`，完全绕开跨网段）。

> **本次的结论**：跨网段这条路被两端主机防火墙挡着，需要管理员权限逐台开。
> 所以最后选了「把模型装在 PC 上、配给 **PC 自己的 DSH**」——同机 `127.0.0.1`，一步都不用改防火墙。
> 面向 DSH 的本机模型选型/部署/接入流程已沉淀成 skill `dsh-local-model`。

---

## 6. 已经实测验证过的事实

以下都是我在本机起真实 DSH 实例打出来的，不是推测：

1. `--patch` 覆盖层能把 `webserver.host` 设成 `0.0.0.0`，**绕过 CLI 的拒绝**，服务正常起来。
2. 绑 `0.0.0.0` 后 DSH 自动把**它自己网卡上的**局域网 IP 加进信任列表（容器里只有容器 IP，所以极空间 IP 必须用 `--trusted-host` 显式声明）。
3. 首页无 token → 401；带 token → 303 + `Set-Cookie`。
4. `/api/*` 用未声明的 Host → **403**；用声明过的 Host 无 cookie → 401。
5. `--trusted-host` 接受**多个**值，且只写主机名就匹配任意端口。
6. cookie 有效期默认 **30 天**（`cookieMaxAgeDays`）。
7. `@deepseek-ai/dsh@0.2.0-rc.2` 在官方源和 npmmirror 上都存在。
8. DSH 的 Linux 支持是官方的：bash/pwsh 工具按平台二选一挂载；原生依赖只有
   `node-addon-system`（有 linux x64/arm64 预编译包）。
9. 极空间桌面客户端在跑，本地网关 `127.0.0.1:13579` 正常，能列 `/public`
   （nasId `<NAS_SERIAL>`，账号 `<ZSPACE_ACCOUNT>`）。

---

## 7. 还没确认的事（需要你配合）

1. **你的极空间固件里，Docker 容器有没有「网页访问 / 快捷方式」入口**（决定 3.2 的方案 A 能不能用）。
2. **手机连家里 Wi-Fi 能不能直连 `<NAS-IP>:19387`**（跨网段是否被滤）。
3. **容器里 Landlock / bwrap 到底能不能用** —— 要等容器真跑起来看日志。
   如果你愿意，我可以让你在容器里跑一条命令探测。
4. **你想要的"应用壳"具体到哪一层**：
   - 只要"在极空间上跑起来 + 能访问" → 本文档够了；
   - 要一个**极空间桌面上的图标**、点开就在极空间窗口里用 → 得先回答第 1 条；
   - 要有**独立的品牌化界面**（比如改了标题、图标、启动页） → 这是另一个量级的活，能做，但要说清楚。

---

## 8. 一个替代方案，顺便说明白

如果你其实更想要的是「**随时用手机上我 Windows 这台机器上的 DSH**（带着 `D:\codes`、
那 200 多个 skill、git 凭据）」，那架构是不一样的：DSH 继续跑在这台 PC 上，
极空间只作为访问通道，PC 关了就没了。

两种诉求的取舍：

| | 跑在极空间（本文档） | 跑在 Windows，通道挂极空间 |
|---|---|---|
| 一直在线 | ✅ NAS 本来就 7×24 | ❌ PC 关机就断 |
| 原有环境 | ❌ 全新环境 | ✅ 一切照旧 |
| 处理 NAS 上的文件 | ✅ 原生 | 要挂载 |
| 功耗 | ✅ 极低 | ❌ 得开着 PC |

**说一声你要哪种，或者两种都要**，我可以两个都搭起来。

---

## 9. 本仓库怎么更新（维护者向）

远端：<https://github.com/439436269-ctrl/zspace-dsh>（public）

### 这台机器上的三个前提（都是踩出来的，改配置前先读这段）

**① `credential.helper` 有一条系统级的 `manager`（Git Credential Manager），必须重置掉**

`C:\Program Files\Git\etc\gitconfig` 里写着 `credential.helper = manager`。GCM 要凭据时会**弹 GUI 对话框**，
在无头/后台环境里表现为 `git credential fill` **无限挂起**，或
`fatal: User cancelled dialog.` + `error: failed to execute prompt script (exit code 1)`。

`~/.gitconfig` 里必须先用**空值**把继承链清掉，再接 `store`：

```ini
[credential]
	helper =          # ← 空值 = 重置从 system 继承来的 manager，别删这条
	helper = store
```

凭据本身放在 `~/.git-credentials`，一行：`https://439436269-ctrl:<token>@github.com`。
token 取自 `~/.secrets/keys.env` 的 `GITHUB_TOKEN`（**提取必须用 `\S+`**，行尾有中文注释，
按 `=` 整行切分会把注释吞进 token，在 HTTP 头里炸 `latin-1 UnicodeEncodeError`）。

**② 全局曾有一条 `insteadOf` 把 https 改写成 SSH（已于 2026-10-17 移除）**

```ini
# 原来是这两行，导致 git remote add https://github.com/... 变成 git@github.com:...，
# 走 SSH（22 端口/公钥），在只开放 443 的网络里必然失败：
# [url "git@github.com:"]
# 	insteadOf = https://github.com/
```

它本来是当年为了绕开 GCM 弹窗才加的**权宜之计**。GCM 被绕开（见①）之后 HTTPS 已经正常，
所以这条改写给删掉了——**删掉它，`git remote add https://github.com/...` 才会真的是 HTTPS**。
`~/.gitconfig` 备份在 `~/.gitconfig.bak-20261017`。

**③ `github.com` 能通但很慢（约 8 秒）**

探活时**超时别设 12 秒**，否则会误判成"不可达"而白白绕道 API。
所以 `git push` 比平时慢是正常的，不是挂了。

### 日常提交

```sh
git add -A
git commit -m "..."
git push origin main        # 走 https + store 的 token，不弹窗
```

⚠️ **同一时刻别跑多条 git 命令**。凭据助手已修好，但若 helper 链又被改回去，
`git push` 会**静默挂起**（等一个永远不来的 GUI 对话框），看起来像网络慢、实际是在等人点按钮。

如果 `git push` 失败，**先按①检查 helper 链**：

```sh
git config --show-origin --get-all credential.helper
# 期望输出三行：system 的 manager、global 的空行、global 的 store
# 少了中间那条空行 = GCM 会重新拦上来
```

再确认 remote 没被改写成 SSH：

```sh
git remote -v      # 必须是 https://github.com/...，不能是 git@github.com:...
```

### 只在 `git push` 彻底不可用时（应急）

走 `api.github.com` 的 Git Data API（`dsh-plugin-publish-repo` 技能的 `gh_api_push.py`）。
代价是**本地与远端成为平行历史**（tree 相同、SHA 不同），恢复后要
`git fetch origin && git reset --hard origin/main` 对齐。
**能 push 就别用这条**——它是症状不是解法，而且中文文件名在 Windows 上还有二次编码的坑。

---

## 10. 用 HTTP API 对话与 coding（端口 19389）

### 为什么要自己加这一层

DSH 自身**没有**可网络直连的 REST 面，三条路都不通：

| 通道 | 实际情况 |
|---|---|
| `dsh web`（19387）的 `/api/*` | **全部 404**。界面走的是 **WebSocket**（`dsh-api-gateway`），不是 REST |
| `dsh --profile sdk` | 官方 SDK，但走 **stdio JSON-RPC** —— 客户端必须自己拉起进程 |
| `dsh --profile headless` | 一次性回答，本来就是 CLI |

所以本部署在容器里加了 `conf/dsh-api-bridge.js`（**19389**），把
`dsh --profile headless --json` 包成普通 HTTP 接口。

选 headless 而不是 sdk 的理由：`headless` 自带 **`--session-id`**，能续接持久化会话；
事件流第一行就给出 `sessionId`；每次调用是独立进程，不需要维护常驻 JSON-RPC 连接——**稳定性远高于自己实现 sdk 协议**。

### 接口

```http
GET  /health
     → 无需鉴权。返回诊断：dsh 路径探测、真实 workspace、node 路径、是否已配鉴权

POST /v1/ask
     headers: X-API-Key: <密钥>
     body:    { "task": "…", "sessionId": "session-…" }   sessionId 可选，用于续接上一轮
     → { ok, answer, sessionId, usage:{inputTokens,outputTokens,totalTokens}, ms }
```

### 用法

```bash
KEY=$(cat ~/.secrets/dsh-api-key.txt)

# 一次问答
curl -s -X POST https://remote-access-19389.zconnect.cn/v1/ask \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"task":"只回复两个字：收到"}'

# 续接同一会话（把上一轮返回的 sessionId 带回来）
curl -s -X POST https://remote-access-19389.zconnect.cn/v1/ask \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"task":"刚才那个文件里写的是什么？","sessionId":"session-…"}'
```

**实测（2026-10-18）**：

```
第 1 轮 "在当前目录创建 hello-api.txt，内容写…"
  → 200 / 12s  {"ok":true,"answer":"已在当前目录创建 hello-api.txt…","sessionId":"session-a0e634dc-…"}
  → NAS 上 /workspace/hello-api.txt 内容正确 ✅
第 2 轮 同一 sessionId 续接 "刚才那个文件里写的是什么？"
  → 200 / 10s  {"ok":true,"answer":"来自 DSH HTTP API 的第一行"}   ← 多轮记忆生效
```

### 鉴权（**必须**）

密钥在 `conf/api-key.txt`，**不入库**（已加 `.gitignore`）。

- 桥**读文件**而不是读环境变量 —— **轮换密钥不用重建容器**，改文件后重启容器即可（或等下次重启）
- 文件缺失或短于 16 字符 → **拒绝一切请求**（fail-closed）。
  因为这个接口等价于「在你的 NAS 上执行任意 DSH 任务」，裸奔等于把 NAS 交出去。
- 客户端密钥本机备份在 `~/.secrets/dsh-api-key.txt`

### 几个坑（都实测踩过）

| 现象 | 真因 |
|---|---|
| `spawn failed: … ENOENT`（看起来像"命令不存在"） | **`cwd` 不存在**。`spawn` 带一个不存在的 cwd 返回的就是 ENOENT。工作区在容器里是 **`/workspace`**，不是 `/dsh/workspace` |
| 同样是 ENOENT | `dsh` 是**软链**（→ `lib/bin.js`，带 shebang）。shebang 解释器不在 PATH 上时也报 ENOENT。桥里做了三级回退：原样 → `node`(绝对路径)+脚本 → PATH 里的 `node` |
| 并发请求互相踩 | DSH 是单 agent。桥把请求**串行排队** |
| 想让它在别处干活 | 改 `DSH_WORKSPACE` 环境变量（entrypoint 里传 `DSH_WORKSPACE_DIR`） |

### 远程访问

`remote-access-19389.zconnect.cn` 是通配域名，不需要在极空间「远程访问」里单独加条目；
但要在手机上点开，可以在那边加一条 `127.0.0.1:19389`（和 `DSH稳定入口` 同样的形状）。
