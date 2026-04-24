#!/usr/bin/env bash
# deploy/scripts/setup-vm.sh
#
# ONE-TIME bootstrap for a fresh Debian 12 GCP VM.
# Run as root (or with sudo) immediately after the VM is created.
#
# What this does, in order:
#   1. System packages + Docker
#   2. Nginx
#   3. Certbot (Let's Encrypt)
#   4. Create an unprivileged "deploy" user that GitHub Actions SSHs into
#   5. Create /opt/midswap directory structure
#   6. Open GCP firewall ports (HTTP + HTTPS)
#   7. Enable Nginx + orchestrator to start on boot
#
# Usage:
#   # On your local machine:
#   gcloud compute scp deploy/scripts/setup-vm.sh deploy@VM_NAME:~/
#   gcloud compute ssh VM_NAME -- 'sudo bash ~/setup-vm.sh'
#
# After this script finishes you still need to:
#   a) Fill in /opt/midswap/.env (use deploy/.env.example as the template)
#   b) Copy swap-state.json: scp htlc-ft-cli/swap-state.json deploy@VM:/opt/midswap/
#   c) Copy nginx config:    scp deploy/nginx/midswap.conf deploy@VM:~/ then
#      sudo cp ~/midswap.conf /etc/nginx/sites-available/midswap
#      sudo ln -sf /etc/nginx/sites-available/midswap /etc/nginx/sites-enabled/
#      sudo nginx -t && sudo systemctl reload nginx
#   d) Issue the SSL cert:   sudo certbot --nginx -d YOUR_DOMAIN -d www.YOUR_DOMAIN
#   e) Add your deploy SSH public key:
#      sudo -u deploy bash -c 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys' < ~/.ssh/id_rsa.pub

set -euo pipefail

# ── 0. Config ─────────────────────────────────────────────────────────────────
# Edit these before running the script.
DOMAIN="midotc.fairway.global"   # e.g. midswap.yourdomain.com
GITHUB_USERNAME="ermiappz"  # GitHub username — used to pull from GHCR
GHCR_TOKEN="YOUR_GHCR_TOKEN"  # GitHub PAT with read:packages scope

echo "==> [1/7] Update system packages + essential tools"
apt-get update -qq
apt-get upgrade -y -qq

# Essential tools every server needs:
#   curl      — used by the Docker install script + health checks
#   git       — useful for debugging (checking what commit is deployed)
#   ufw       — simple firewall frontend (we configure it below)
#   unzip     — needed by some package post-install scripts
#   htop      — human-readable process/memory monitor (ops quality of life)
#   jq        — parse JSON on the command line (useful for API debugging)
apt-get install -y curl git ufw unzip htop jq

# ── 1. Docker ─────────────────────────────────────────────────────────────────
echo "==> [2/7] Install Docker"
# Official Docker install script — adds the Docker apt repo and installs
# docker-ce, docker-ce-cli, containerd.io, and docker-compose-plugin.
# The "compose plugin" is the modern replacement for docker-compose v1.
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

# Add the deploy user to the docker group so it can run `docker compose`
# without sudo. (We create the user below, so we'll add it again there.)
systemctl enable --now docker

# ── 2. Nginx ─────────────────────────────────────────────────────────────────
echo "==> [3/7] Install Nginx"
apt-get install -y nginx
systemctl enable nginx

# Remove the default placeholder site so it doesn't interfere.
rm -f /etc/nginx/sites-enabled/default

# Create the webroot directory GitHub Actions will deploy UI files into.
mkdir -p /var/www/midswap
mkdir -p /var/www/certbot

# ── 3. Certbot ───────────────────────────────────────────────────────────────
echo "==> [4/7] Install Certbot"
apt-get install -y certbot python3-certbot-nginx

# Certbot auto-renews certificates via a systemd timer (installed by the
# package). Verify it is active:
#   sudo systemctl status certbot.timer
#
# You still need to issue the first certificate manually AFTER Nginx is
# configured with your domain:
#   sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}

# ── 4. Deploy user ───────────────────────────────────────────────────────────
echo "==> [5/7] Create deploy user"
# "deploy" is a locked system account — it cannot log in with a password,
# only with an SSH key. This follows the principle of least privilege:
# GitHub Actions gets only what it needs to copy files and run docker compose.
if ! id deploy &>/dev/null; then
    useradd --system --shell /bin/bash --create-home deploy
fi

# Add deploy to docker group (no sudo needed for docker compose)
usermod -aG docker deploy

# Grant deploy passwordless sudo — required because GitHub Actions runs
# non-interactive commands (sudo nginx -t, sudo certbot, sudo cp, etc.)
# and there is no human to type a password. The account is locked (no
# password login), so the only way in is via the SSH key we control.
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy
chmod 440 /etc/sudoers.d/deploy

# Grant deploy write access to the UI static-file directory
chown -R deploy:www-data /var/www/midswap
chmod -R 775 /var/www/midswap

# Prepare SSH authorized_keys for the deploy user.
# You'll add your GitHub Actions SSH public key here manually:
#   sudo -u deploy bash -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh'
#   echo "ssh-ed25519 AAAA..." | sudo -u deploy tee -a /home/deploy/.ssh/authorized_keys
sudo -u deploy bash -c 'mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'

# ── 5. Midswap directories ───────────────────────────────────────────────────
echo "==> [6/7] Create /opt/midswap"
mkdir -p /opt/midswap/data
mkdir -p /opt/midswap/scripts   # GitHub Actions SCPs deploy.sh here on every push
# The deploy user owns /opt/midswap so it can write docker-compose.yml,
# pull updated images, and execute deploy.sh without needing sudo.
chown -R deploy:deploy /opt/midswap

# Copy docker-compose.yml template into place (GitHub Actions keeps it updated).
# The first time you need to scp it manually:
#   scp deploy/docker-compose.yml deploy@VM:/opt/midswap/docker-compose.yml

# Copy the .env template — fill it in after the script finishes.
if [[ ! -f /opt/midswap/.env ]]; then
    cat > /opt/midswap/.env << EOF
# Fill in real values — see deploy/.env.example in the repository.
GHCR_USER=${GITHUB_USERNAME}
IMAGE_TAG=latest
BLOCKFROST_API_KEY=REPLACE_ME
MIDNIGHT_NETWORK=preprod
CORS_ORIGINS=https://${DOMAIN}
LOG_LEVEL=info
EOF
    chown deploy:deploy /opt/midswap/.env
    chmod 600 /opt/midswap/.env
fi

# ── 6. Firewall ──────────────────────────────────────────────────────────────
echo "==> Configuring UFW firewall"
# UFW (Uncomplicated Firewall) is a frontend for iptables.
# GCP also has a network-level firewall — UFW adds a second layer on the VM itself.
# Rule: deny everything incoming by default, then punch specific holes.
ufw --force reset
ufw default deny incoming   # block all inbound traffic unless explicitly allowed
ufw default allow outgoing  # the VM can initiate outbound connections freely
ufw allow ssh               # port 22 — needed for gcloud ssh + GitHub Actions deploy
ufw allow http              # port 80 — needed for Certbot ACME challenge + redirect
ufw allow https             # port 443 — the real app traffic
# Note: port 4000 (orchestrator) is NOT opened — it's internal only, reached via Nginx
ufw --force enable

# ── 7. GHCR authentication ───────────────────────────────────────────────────
# The VM needs to log in to GitHub Container Registry once so it can pull
# private images in future deploys without interactive credentials.
# Using the deploy user so the credentials are stored in /home/deploy/.docker/
echo "==> Logging deploy user into GHCR"
echo "${GHCR_TOKEN}" | sudo -u deploy docker login ghcr.io \
    --username "${GITHUB_USERNAME}" \
    --password-stdin

# ── 7. Boot services ─────────────────────────────────────────────────────────
echo "==> [7/7] Enable services on boot"
systemctl enable nginx docker

# A systemd service for the orchestrator lets the OS restart it after a reboot
# without needing to SSH in and run docker compose manually.
cat > /etc/systemd/system/midswap-orchestrator.service << 'SERVICE'
[Unit]
Description=Midswap Orchestrator (Docker Compose)
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/midswap
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable midswap-orchestrator

echo ""
echo "✅ VM bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Fill in /opt/midswap/.env with real secrets"
echo "  2. scp swap-state.json deploy@${DOMAIN}:/opt/midswap/"
echo "  3. scp deploy/docker-compose.yml deploy@${DOMAIN}:/opt/midswap/"
echo "  4. scp deploy/nginx/midswap.conf deploy@${DOMAIN}:~/"
echo "  5. On VM: sudo cp ~/midswap.conf /etc/nginx/sites-available/midswap"
echo "            sudo ln -sf /etc/nginx/sites-available/midswap /etc/nginx/sites-enabled/"
echo "            # Edit the conf to replace YOUR_DOMAIN"
echo "            sudo nginx -t && sudo systemctl reload nginx"
echo "  6. sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo "  7. Add GitHub Actions SSH public key to /home/deploy/.ssh/authorized_keys"
echo "  8. Push to main branch and watch the GitHub Actions workflow"
