# ══════════════════════════════════════════════════════════════════════════
# VPS Control — Production image
# ──────────────────────────────────────────────────────────────────────────
# Base: node:20-bookworm-slim (Debian) thay vì Alpine
#   • Alpine dùng musl → node-pty phải compile lại + thiếu nhiều tool
#   • Debian có glibc + apt → cài tmux, python, gcc dễ dàng
# ══════════════════════════════════════════════════════════════════════════

FROM node:20-bookworm-slim

# ──────────────────────────────────────────────────────────────────────────
# Cài các package cần thiết:
#   BUILD      : python3, make, g++ → để compile node-pty native module
#   TMUX       : giữ terminal session qua reload
#   RUNTIME    : bash, curl, git, vim, nano, htop… → coi container như VPS mini
# ──────────────────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    # build deps cho node-pty
    python3 python3-pip python3-venv \
    make g++ gcc \
    # terminal multiplexer
    tmux \
    # shell + tools cơ bản
    bash curl wget git ca-certificates \
    # editors trong terminal
    vim nano less \
    # system tools
    htop procps \
    iputils-ping net-tools \
    jq \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

WORKDIR /app

# ──────────────────────────────────────────────────────────────────────────
# Layer 1: deps (cache theo package.json — rebuild nhanh khi chỉ sửa code)
# ──────────────────────────────────────────────────────────────────────────
COPY package*.json ./
RUN npm install --omit=dev \
    && npm cache clean --force

# ──────────────────────────────────────────────────────────────────────────
# Layer 2: application code
# ──────────────────────────────────────────────────────────────────────────
COPY server.js ./
COPY public ./public

# Data directory — mount Railway volume vào /data để persist
RUN mkdir -p /data/files && chmod 755 /data

ENV DATA_DIR=/data \
    PORT=3000 \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production

EXPOSE 3000

# ──────────────────────────────────────────────────────────────────────────
# Healthcheck — Railway/Docker dùng để biết container còn sống
# ──────────────────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
