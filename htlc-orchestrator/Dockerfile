# Build context is the repo ROOT (set via `file:` in the GitHub Actions workflow).
# This is required because the project uses npm workspaces — there is one
# package-lock.json at the root shared by all packages including htlc-orchestrator.

# ── Deps stage ───────────────────────────────────────────────────────────────
FROM node:24-slim AS deps

# python3 + make + g++ are required by node-gyp to compile better-sqlite3's
# native .node binary. They are only needed at build time, not at runtime.
RUN apt-get update && apt-get install -y \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the root workspace manifest, npm config, and the single shared lockfile.
# npm ci must see the same peer-dependency mode used when the lockfile was made.
COPY package.json package-lock.json .npmrc ./

# Copy every workspace package.json. The root package.json declares the
# workspaces; npm ci needs every one of those manifests on disk to reconcile
# the lockfile's nested dep tree (peer-dep ranges under @lucid-evolution/*
# resolve differently when only a subset of workspaces is visible).
COPY contract/package.json     ./contract/
COPY htlc-ft-cli/package.json  ./htlc-ft-cli/
COPY htlc-ui/package.json      ./htlc-ui/
COPY htlc-orchestrator/package.json ./htlc-orchestrator/

# Install all workspace deps. We deliberately do NOT pass `--omit=dev` here.
# Two failures are avoided by this:
#   1. Workspace-scoped install (`npm ci --workspace=htlc-orchestrator`) re-
#      resolves peer-dep ranges under @lucid-evolution/* in a stricter mode
#      than root install and trips on "Missing: @harmoniclabs/cbor@1.6.6 from
#      lock file" — the lockfile is internally consistent for root install
#      but not for the workspace-scoped tree.
#   2. `npm ci --omit=dev` walks a different (production-only) sub-tree of
#      the lockfile and ALSO trips on the same missing-cbor error, because
#      the cbor@1.6.6 entry's resolution path goes through a chain that
#      includes a dev dep elsewhere in the workspace.
# Plain `npm ci` works — the runtime stage only ships the resulting
# node_modules so other workspaces' deps don't bloat the image meaningfully
# (heavy deps like @midnight-ntwrk/*, lucid-evolution, etc. are already
# orchestrator dependencies; the only extra cost is @types/* packages, ~10MB).
RUN npm ci

# libsodium-wrappers-sumo imports this file by relative path, but the file is
# shipped by the separate libsodium-sumo package.
RUN cp \
    node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs \
    node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:24-slim AS runner

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
