#!/usr/bin/env bash
# Adyton — one-shot Hetzner VPS bootstrap
#
# Run as root once after provisioning a fresh Ubuntu 24.04 LTS server.
# Idempotent: safe to re-run if partially applied.
#
# What it does:
#   1. System packages: Docker, UFW
#   2. UFW rules: allow SSH (22), HTTP (80), HTTPS (443); deny everything else
#   3. Swap: 2 GB swapfile (prevents OOM on 2-4 GB VPS)
#   4. sysctl hardening: rate-limit ICMP, disable source routing, enable SYN cookies
#   5. Docker: enable + start
#
# After running this script, deploy Coolify per https://coolify.io/docs/installation
set -euo pipefail

echo "[setup] updating package index"
apt-get update -qq

echo "[setup] installing Docker"
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

echo "[setup] installing UFW"
apt-get install -y -qq ufw

echo "[setup] configuring firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose

echo "[setup] configuring swap (2 GB)"
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "vm.swappiness=10" >> /etc/sysctl.d/99-adyton.conf
  echo "[setup] swap created"
else
  echo "[setup] swap already exists — skipping"
fi

echo "[setup] applying sysctl hardening"
cat > /etc/sysctl.d/99-adyton.conf << 'EOF'
# Adyton VPS hardening
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
net.ipv4.icmp_ratelimit = 100
net.ipv4.icmp_ratemask = 88089
vm.swappiness = 10
EOF
sysctl --system

echo "[setup] enabling Docker"
systemctl enable --now docker

echo "[setup] all done"
echo ""
echo "Next steps:"
echo "  1. Install Coolify: curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"
echo "  2. Open https://<server-ip>:8000 and complete setup"
echo "  3. Add GitHub repo, configure env vars, and deploy"
