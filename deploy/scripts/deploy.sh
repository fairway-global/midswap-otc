#!/usr/bin/env bash
# deploy/scripts/deploy.sh
#
# Called by the GitHub Actions "deploy" job via SSH on every push to main.
# Runs ON THE VM as the "deploy" user.
#
# Receives the new image tag as the first argument (e.g. "sha-a1b2c3d").
# If omitted, defaults to "latest".
#
# What it does:
#   1. Updates IMAGE_TAG in /opt/midswap/.env so we know which commit is live
#   2. Pulls the new orchestrator image from GHCR
#   3. Restarts the container (zero-downtime: Docker waits for new container
#      to pass the health check before stopping the old one)
#   4. Prunes dangling images to keep disk usage low

set -euo pipefail

IMAGE_TAG="${1:-latest}"
COMPOSE_FILE="/opt/midswap/docker-compose.yml"
ENV_FILE="/opt/midswap/.env"

echo "[deploy] Deploying orchestrator image tag: ${IMAGE_TAG}"

# ── 1. Update IMAGE_TAG ───────────────────────────────────────────────────────
# sed -i edits the file in-place. The \b word boundary ensures we only replace
# the IMAGE_TAG= line and not other lines that happen to contain "IMAGE_TAG".
sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${IMAGE_TAG}|" "${ENV_FILE}"

# ── 2. Pull the new image ─────────────────────────────────────────────────────
# docker compose pull fetches only the services whose image tag changed.
# Because IMAGE_TAG is now updated, this fetches the new orchestrator image.
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" pull orchestrator

# ── 3. Restart ────────────────────────────────────────────────────────────────
# `up -d` starts/restarts services defined in docker-compose.yml.
# `--remove-orphans` removes containers for services that were deleted from
# the compose file — keeps the VM clean.
# Docker health-checks the new container before routing traffic to it, so
# a crashing image doesn't take down the live service.
docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" up -d --remove-orphans

# ── 4. Prune old images ───────────────────────────────────────────────────────
# Each deploy leaves the previous image untagged ("dangling"). Prune them
# so disk doesn't fill up over time. -f skips the "are you sure?" prompt.
docker image prune -f

echo "[deploy] Done — orchestrator is running image tag: ${IMAGE_TAG}"

# Print the last few lines of logs so the GitHub Actions run shows something
# meaningful in the SSH output.
sleep 2
docker logs midswap-orchestrator --tail 20 2>&1 || true
