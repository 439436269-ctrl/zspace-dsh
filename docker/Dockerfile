# =============================================================================
# zspace-dsh — 极空间 DSH 应用壳镜像
#
# 用法（可选）：极空间 Docker 界面里通常不方便构建镜像，所以推荐直接用官方
# `node:22-bookworm-slim` 镜像 + 挂载 scripts/entrypoint.sh。
# 这个 Dockerfile 是给"能本地构建并导入镜像"的场景用的，两者等价。
#
#   docker build -t zspace-dsh:latest -f docker/Dockerfile .
#   docker save zspace-dsh:latest -o zspace-dsh.tar
# =============================================================================
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=Asia/Shanghai \
    DSH_HOME=/dsh/home \
    DSH_NPM_PREFIX=/dsh/npm \
    DSH_CONF_DIR=/dsh/conf \
    WORKSPACE=/workspace

# git / curl 是 agent 的常用工具；bubblewrap 是 DSH Linux 沙箱的首选后端
# （不可用时 DSH 会退到 Landlock，两者都不可用会 fail-closed）。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git tzdata bubblewrap procps less vim-tiny unzip \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /dsh/home /dsh/npm /dsh/conf /workspace

COPY scripts/entrypoint.sh /dsh/conf/entrypoint.sh
RUN chmod +x /dsh/conf/entrypoint.sh

WORKDIR /workspace
EXPOSE 19387

# 无参数启动也可以：entrypoint 自带默认值。极空间 Docker 界面的"命令"留空即可。
ENTRYPOINT ["/dsh/conf/entrypoint.sh"]
