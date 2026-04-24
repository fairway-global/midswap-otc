# Build context is the repo ROOT (set via `file:` in the GitHub Actions workflow).
# This is required because the project uses npm workspaces — there is one
# package-lock.json at the root shared by all packages including htlc-orchestrator.

# ── Deps stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS deps

# python3 + make + g++ are required by node-gyp to compile better-sqlite3's
# native .node binary. They are only needed at build time, not at runtime.
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the root workspace manifest and the single shared lockfile.
COPY package.json package-lock.json ./

# Copy only the orchestrator's package.json so npm can resolve its deps
# from the root lockfile without downloading the rest of the workspace.
COPY htlc-orchestrator/package.json ./htlc-orchestrator/

# Install only this workspace's dependencies.
# --workspace flag installs exactly what htlc-orchestrator/package.json declares.
# Dependencies land in the root /app/node_modules (workspace hoisting).
RUN npm ci --workspace=htlc-orchestrator

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# libsqlite3-0 is the shared library that better-sqlite3's .node binary links
# against at runtime. Must be present in the final image.
RUN apt-get update && apt-get install -y libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled node_modules from the deps stage (avoids re-running npm ci).
COPY --from=deps /app/node_modules ./node_modules

# Copy the orchestrator source and config from the build context root.
COPY htlc-orchestrator/src/        ./src/
COPY htlc-orchestrator/tsconfig.json ./
COPY htlc-orchestrator/package.json  ./

# SQLite data lives on a host-mounted volume, not inside the image.
RUN mkdir -p /data

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "\
        require('http').get('http://localhost:4000/health', r => \
            process.exit(r.statusCode === 200 ? 0 : 1) \
        ).on('error', () => process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/server.ts"]
