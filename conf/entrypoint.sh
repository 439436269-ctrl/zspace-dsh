#!/usr/bin/env bash
# =============================================================================
# zspace-dsh — 极空间 DSH 应用壳启动脚本
#
# 职责：
#   1. 幂等安装 @deepseek-ai/dsh 到挂载卷（重建容器不用重装）
#   2. 生成监听覆盖层，把 Web GUI 绑到 0.0.0.0
#   3. 声明被访问的 authority（极空间 IP / 域名），否则 Host 围栏会拒绝
#   4. 启动 dsh web，抓取入口 token，打印手机/电脑可直接打开的地址
#
# 只依赖 bash + node，不需要在极空间上开 SSH。
# =============================================================================
set -uo pipefail

log() { printf '[zspace-dsh] %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 可调参数（全部走环境变量，极空间 Docker 界面里就能改）
# ---------------------------------------------------------------------------
DSH_VERSION="${DSH_VERSION:-0.2.0-rc.2}"
DSH_NPM_REGISTRY="${DSH_NPM_REGISTRY:-https://registry.npmmirror.com}"
DSH_NPM_FALLBACK_REGISTRY="${DSH_NPM_FALLBACK_REGISTRY:-https://registry.npmjs.org}"

DSH_PORT="${DSH_PORT:-19387}"
DSH_HOST="${DSH_HOST:-0.0.0.0}"
DSH_PERMISSION_MODE="${DSH_PERMISSION_MODE:-workspace-write}"

DSH_HOME="${DSH_HOME:-/dsh/home}"
DSH_NPM_PREFIX="${DSH_NPM_PREFIX:-/dsh/npm}"
DSH_CONF_DIR="${DSH_CONF_DIR:-/dsh/conf}"
WORKSPACE="${WORKSPACE:-/workspace}"

# 入口地址里显示的"极空间地址"：填局域网 IP（如 <NAS-IP>）或域名。
# 留空则只打印 token，由你自己拼地址。
DSH_PUBLIC_HOST="${DSH_PUBLIC_HOST:-}"
# 允许访问的 authority 列表，空格分隔。留空则用 DSH_PUBLIC_HOST。
# 走了域名/内网穿透时，这里必须写域名，否则 /api 围栏会拒绝。
DSH_TRUSTED_HOSTS="${DSH_TRUSTED_HOSTS:-${DSH_PUBLIC_HOST}}"

# 额外信任地址也可以写进文件，一行一个（# 开头是注释）。
# 好处：改完直接重启容器即可生效，不用重建容器；文件在 NAS 上可直接编辑。
# 逐行过滤，只保留形如 host / host:port 的 token —— 文件带 UTF-8 BOM 时，
# BOM 会被当成一个"地址"传给 --trusted-host，而 DSH 会因它不是合法 authority
# 直接拒绝加载整个插件，所以这里必须过滤，不能原样透传。
TRUSTED_FILE="${DSH_CONF_DIR:-/dsh/conf}/trusted_hosts.txt"
extra_hosts=""
if [ -f "$TRUSTED_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    for h in $line; do
      case "$h" in
        *[!A-Za-z0-9.:_-]*) continue ;;
        "") continue ;;
      esac
      extra_hosts="$extra_hosts $h"
    done
  done < "$TRUSTED_FILE"
  log "从 ${TRUSTED_FILE} 读到额外信任地址：${extra_hosts:-<无>}"
fi
DSH_TRUSTED_HOSTS="${DSH_TRUSTED_HOSTS} ${extra_hosts}"

# 可选密钥/环境变量文件：容器不用重建就能换 API key。
#   例：export DEEPSEEK_API_KEY=sk-xxxx
# 为什么需要它：DSH 的网页端「设置 → 模型」在**非回环地址**下是禁用的
# （客户端里是 `remote.$host.isLoopback ? "host" : "memory"`，非回环时不加载
#  设置镜像，页面会报 "settings are unavailable in this browser"）。
# 而从服务端喂凭据不受这个限制 —— 凭据解析是「环境变量优先于凭据文件」。
ENV_FILE="${DSH_CONF_DIR}/env.sh"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  # 只打印变量名，绝不打印值
  exported="$(grep -oE '^[[:space:]]*export[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' "$ENV_FILE" 2>/dev/null | sed 's/.*[[:space:]]//' | tr '\n' ' ')"
  log "已加载 ${ENV_FILE}（导出变量：${exported:-<无>}）"
fi

DSH_BIN="${DSH_NPM_PREFIX}/bin/dsh"
PATCH_FILE="${DSH_HOME}/10-listen.yml"
EXTRA_PATCH="${DSH_CONF_DIR}/extra.patch.yml"
LOG_FILE="${DSH_HOME}/container.log"
URL_FILE="${DSH_HOME}/entry-url.txt"

export DSH_HOME DSH_PERMISSION_MODE TZ="${TZ:-Asia/Shanghai}"

if [ -n "${DEEPSEEK_API_KEY:-}" ]; then
  export DEEPSEEK_API_KEY
  log "DEEPSEEK_API_KEY 已就位（长度 ${#DEEPSEEK_API_KEY}，内容不打印）"
fi

log "版本=${DSH_VERSION} 端口=${DSH_PORT} 权限模式=${DSH_PERMISSION_MODE}"
log "DSH_HOME=${DSH_HOME} 工作区=${WORKSPACE} 公开地址=${DSH_PUBLIC_HOST:-<未设置>}"

mkdir -p "$DSH_HOME" "$DSH_NPM_PREFIX" "$DSH_CONF_DIR" "$WORKSPACE" 2>/dev/null || true

# ---------------------------------------------------------------------------
# 1) 可选依赖：bubblewrap 是 DSH Linux 沙箱的首选后端。
#    装不上不影响启动（会退到 Landlock），所以这里失败了也只告警。
# ---------------------------------------------------------------------------
if [ "$DSH_PERMISSION_MODE" != "danger-full-access" ] && ! command -v bwrap >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    log "尝试安装 bubblewrap（Linux 沙箱首选后端）…"
    if apt-get update -qq >/dev/null 2>&1 && \
       apt-get install -y -qq --no-install-recommends bubblewrap >/dev/null 2>&1; then
      log "bubblewrap 安装完成"
    else
      log "警告：bubblewrap 安装失败，将退到 Landlock 后端"
      log "警告：若两者都不可用，DSH 沙箱会 fail-closed；届时把 DSH_PERMISSION_MODE 改成 danger-full-access"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 2) 幂等安装 dsh CLI 到挂载卷
# ---------------------------------------------------------------------------
installed=""
if [ -x "$DSH_BIN" ]; then
  installed="$("$DSH_BIN" --version 2>/dev/null | tr -d '[:space:]')"
fi

if [ "$installed" != "$DSH_VERSION" ]; then
  log "安装 @deepseek-ai/dsh@${DSH_VERSION}（当前：${installed:-无}）…"
  if ! npm install -g --prefix "$DSH_NPM_PREFIX" \
        --registry "$DSH_NPM_REGISTRY" \
        "@deepseek-ai/dsh@${DSH_VERSION}" 2>&1 | tail -n 20; then
    log "主源失败，改用 ${DSH_NPM_FALLBACK_REGISTRY} 重试…"
    npm install -g --prefix "$DSH_NPM_PREFIX" \
      --registry "$DSH_NPM_FALLBACK_REGISTRY" \
      "@deepseek-ai/dsh@${DSH_VERSION}" 2>&1 | tail -n 20 || {
        log "致命错误：dsh 安装失败，检查容器网络或 registry 设置"
        exit 1
      }
  fi
fi

[ -x "$DSH_BIN" ] || { log "致命错误：${DSH_BIN} 不存在"; exit 1; }
log "dsh 就绪：$("$DSH_BIN" --version 2>/dev/null || echo '?')"

# ---------------------------------------------------------------------------
# 3) 生成监听覆盖层
#
#    dsh 的 --host 标志故意拒绝 0.0.0.0（怕把 RCE 暴露到网络）。但 webserver
#    是配置树里的一行，patch 层直接写同一个值就绕过了那个 CLI 守卫。
#    注意：patch 是"整块替换 config"，所以这里必须把 webserver 原有的键都写全。
# ---------------------------------------------------------------------------
cat > "$PATCH_FILE" <<YAML
# 由 zspace-dsh entrypoint 生成；每次启动覆盖。
# dsh web 的 --host 会拒绝 0.0.0.0，这里从配置层直接指定同一个值。
- id: webserver
  config:
    host: '${DSH_HOST}'
    port: ${DSH_PORT}
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
YAML

# ---------------------------------------------------------------------------
# 4) 组装启动参数
#
#    关键：容器里 networkInterfaces() 只看到容器自己的 IP（172.x），
#    DSH 从 0.0.0.0 推导出的"局域网可信地址"因此不含极空间的真实 IP。
#    必须用 --trusted-host 显式声明，否则浏览器带 Host: <极空间IP>:端口
#    的请求会被 /api 围栏拒掉。
# ---------------------------------------------------------------------------
args=( web --patch "$PATCH_FILE" )

if [ -f "$EXTRA_PATCH" ]; then
  log "附加覆盖层：${EXTRA_PATCH}"
  args+=( --patch "$EXTRA_PATCH" )
fi

if [ -n "${DSH_TRUSTED_HOSTS// /}" ]; then
  args+=( --trusted-host )
  for h in $DSH_TRUSTED_HOSTS; do args+=( "$h" ); done
  log "信任的访问地址：${DSH_TRUSTED_HOSTS}"
else
  log "警告：未设置 DSH_PUBLIC_HOST/DSH_TRUSTED_HOSTS，局域网访问会被 Host 围栏拒绝"
fi

args+=( --no-open )

# 诊断：列出容器可见的所有非回环 IPv4。
# host 网络模式下这就是 NAS 的真实网卡地址，DSH 会把它们自动加入 Host 信任列表，
# 所以 DSH_PUBLIC_HOST 通常不用填。
if command -v hostname >/dev/null 2>&1; then
  log "本机 IPv4：$(hostname -I 2>/dev/null || echo '?')"
fi

# ---------------------------------------------------------------------------
# 5) 启动 + 抓取入口地址
# ---------------------------------------------------------------------------
: > "$LOG_FILE"
rm -f "$URL_FILE"

cd "$WORKSPACE" 2>/dev/null || cd /

log "启动：${DSH_BIN} ${args[*]}"
"$DSH_BIN" "${args[@]}" >>"$LOG_FILE" 2>&1 &
child=$!

# 稳定入口：把 :19388 重定向到当前带 token 的真实地址。
# dsh 的 token 每个进程随机生成、重启就变，直接发带 token 的地址给用户，
# 容器一重启书签和极空间桌面图标就会 401。有了这个重定向，固定地址永远可用。
shim_pid=""
if [ -f "${DSH_CONF_DIR}/entry-redirect.js" ]; then
  DSH_LOG="$LOG_FILE" DSH_PORT="$DSH_PORT" DSH_ENTRY_PORT="${DSH_ENTRY_PORT:-19388}" \
    node "${DSH_CONF_DIR}/entry-redirect.js" >>"$LOG_FILE" 2>&1 &
  shim_pid=$!
  log "稳定入口已启动：http://<极空间IP>:${DSH_ENTRY_PORT:-19388}/  （不随重启变化，推荐用它）"
fi

term() {
  kill -TERM "$child" 2>/dev/null || true
  if [ -n "$shim_pid" ]; then kill -TERM "$shim_pid" 2>/dev/null || true; fi
}
trap term TERM INT

# 把子进程日志回显到容器 stdout，同时抓 token 生成入口地址
(
  tail -n +1 -F "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do
    printf '%s\n' "$line"
    case "$line" in
      *"dsh web: "*)
        if [ ! -s "$URL_FILE" ]; then
          tok="$(printf '%s' "$line" | sed -n 's/.*[?&]token=\([A-Za-z0-9_-]*\).*/\1/p')"
          if [ -n "$tok" ]; then
            if [ -n "$DSH_PUBLIC_HOST" ]; then
              entry="http://${DSH_PUBLIC_HOST}:${DSH_PORT}/?token=${tok}"
            else
              entry="http://<极空间的IP或域名>:${DSH_PORT}/?token=${tok}"
            fi
            printf '%s\n' "$entry" > "$URL_FILE"
            {
              printf '\n'
              printf '=====================================================================\n'
              printf '  稳定入口（推荐长期使用，不随容器重启变化）\n'
              printf '\n'
              printf '  http://<极空间IP或域名>:%s/\n' "${DSH_ENTRY_PORT:-19388}"
              printf '\n'
              printf '  一次性入口（当前 token，重启后失效）\n'
              printf '\n'
              printf '  %s\n' "$entry"
              printf '\n'
              if [ -z "$DSH_PUBLIC_HOST" ]; then
                printf '  提示：把 <极空间的IP或域名> 换成你极空间的实际地址，\n'
                printf '       例如 http://<NAS-IP>:%s/?token=%s\n' "$DSH_PORT" "$tok"
              fi
              printf '  首次打开会换成 30 天的签名 cookie，之后不用再带 token。\n'
              printf '=====================================================================\n'
              printf '\n'
            }
          fi
        fi
        ;;
    esac
  done
) &
tailer=$!

wait "$child"
code=$?
kill "$tailer" 2>/dev/null || true
log "dsh 退出，退出码 ${code}"
exit "$code"
