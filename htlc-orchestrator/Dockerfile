# ─── Build stage ────────────────────────────────────────────────────────────
# We need full Debian (not alpine) because better-sqlite3 compiles a native
# .node binary via node-gyp, which needs python3 + gcc + make.
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy manifests first so Docker's layer cache skips npm ci when only
# src/ changes (the most common case during iterative deploys).
COPY package*.json ./
RUN npm ci

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# libsqlite3-0 is the shared lib that better-sqlite3's .node binary links to.
RUN apt-get update && apt-get install -y libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy pre-built node_modules from the deps stage (avoids re-running npm ci)
COPY --from=deps /app/node_modules ./node_modules

# Copy source and TypeScript config (tsx runs TS directly, no compile step needed)
COPY src/        ./src/
COPY tsconfig.json ./
COPY package.json  ./

# The SQLite database lives on a mounted host volume, not inside the image.
# This directory is the mount point declared in docker-compose.yml.
RUN mkdir -p /data

# Only bind to localhost; Nginx is the public face.
EXPOSE 4000

# Docker will mark the container unhealthy and restart it if the /health
# endpoint stops responding — a safety net during deploys and crashes.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "\
        require('http').get('http://localhost:4000/health', r => \
            process.exit(r.statusCode === 200 ? 0 : 1) \
        ).on('error', () => process.exit(1))"

# tsx runs TypeScript directly without a compilation step, which is fine
# here because startup latency is not a concern for a long-lived process.
CMD ["node_modules/.bin/tsx", "src/server.ts"]
