FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    make g++ gcc \
    tmux \
    bash curl wget git ca-certificates \
    vim nano less \
    htop procps \
    iputils-ping net-tools \
    jq \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

RUN curl -fsSL https://go.dev/dl/go1.22.5.linux-amd64.tar.gz \
    | tar -C /usr/local -xz \
    && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
    && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt

ENV PATH="/usr/local/go/bin:${PATH}" \
    GOPATH="/data/go" \
    GOCACHE="/tmp/go-cache" \
    GOFLAGS="-mod=mod"

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY . .

RUN mkdir -p /data/files /app/views /app/public

ENV DATA_DIR=/data \
    PORT=3000 \
    TERM=xterm-256color \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
