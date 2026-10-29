#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SHAKTI — Oracle Cloud Always Free Ubuntu VM Bootstrap Script
# Target Architecture: Ubuntu 22.04 / 24.04 (ARM64 Ampere A1 or AMD64)
# Recommended Always Free Shape: VM.Standard.A1.Flex (1–2 OCPUs, 6–12 GB RAM)
# ==============================================================================

DOMAIN_ARG="${1:-}"

echo "==> [1/5] Inspecting VM architecture and resources..."
uname -m
free -h || true
df -h / || true

echo "==> [2/5] Installing Docker & Docker Compose if not present..."
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg iptables-persistent
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER" || true
fi

echo "==> [3/5] Opening public HTTP (80) and HTTPS (443) ports in Ubuntu iptables..."
# Oracle Cloud Ubuntu images include default iptables INPUT rules that reject 80/443 even when VCN Security Lists allow them.
sudo iptables -I INPUT 1 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null 2>&1; then
  sudo netfilter-persistent save || true
fi

echo "==> [4/5] Configuring .env with strong cryptographic secrets and HTTPS domain..."
if [ -z "$DOMAIN_ARG" ]; then
  PUBLIC_IP="$(curl -fsSL --max-time 5 https://ifconfig.me || curl -fsSL --max-time 5 https://api.ipify.org || echo "localhost")"
  if [ "$PUBLIC_IP" != "localhost" ]; then
    SHAKTI_DOMAIN="${PUBLIC_IP}.nip.io"
  else
    SHAKTI_DOMAIN="localhost"
  fi
else
  SHAKTI_DOMAIN="$DOMAIN_ARG"
fi

if [ ! -f .env ]; then
  JWT_SECRET="$(openssl rand -hex 48)"
  HMAC_SECRET="$(openssl rand -hex 48)"
  cat > .env <<EOF
NODE_ENV=staging
ENVIRONMENT=staging
SERVE_STATIC=true
PORT=3000
SHAKTI_DOMAIN=${SHAKTI_DOMAIN}
TRUST_PROXY=1
COOKIE_SECURE=true
DEMO_MODE=true
ALLOW_MOCK_PROVIDERS=true
DATABASE_URL=file:/data/shakti.db
JWT_SECRET_KEY=${JWT_SECRET}
HMAC_SECRET_KEY=${HMAC_SECRET}
CORS_ORIGINS=https://${SHAKTI_DOMAIN}
APP_URL=https://${SHAKTI_DOMAIN}
VITE_API_BASE_URL=/api
VITE_ANDROID_APK_URL=/shakti.apk
EOF
  chmod 600 .env
  echo "Created .env for domain: https://${SHAKTI_DOMAIN}"
else
  echo "Existing .env found — preserving existing secrets and configuration."
fi

echo "==> [5/5] Building and starting SHAKTI + Caddy HTTPS containers..."
sudo docker compose up -d --build

echo "=============================================================================="
echo "SHAKTI deployment started!"
echo "HTTPS Website URL:  https://${SHAKTI_DOMAIN}"
echo "Android APK URL:    https://${SHAKTI_DOMAIN}/shakti.apk"
echo "Health Endpoint:    https://${SHAKTI_DOMAIN}/api/health"
echo "Note: Ensure ports 80 and 443 are also allowed in your Oracle Cloud VCN Ingress Rules."
echo "=============================================================================="
