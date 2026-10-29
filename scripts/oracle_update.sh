#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# SHAKTI — Safe One-Command Update & Recovery Script for Oracle Cloud VM
# Performs an atomic SQLite backup before pulling new code and rebuilding.
# ==============================================================================

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="/data/backups/pre-update-${TIMESTAMP}.db"

echo "==> [1/4] Creating atomic SQLite backup inside shakti_data volume (${BACKUP_PATH})..."
if sudo docker ps --format '{{.Names}}' | grep -q '^shakti-app$'; then
  sudo docker exec shakti-app npx tsx scripts/db_backup_restore.ts backup "${BACKUP_PATH}" || true
fi

echo "==> [2/4] Pulling latest repository changes..."
git pull --ff-only

echo "==> [3/4] Rebuilding and restarting shakti-app container (preserving /data volume)..."
sudo docker compose up -d --build app

echo "==> [4/4] Verifying post-update /health check..."
for i in 1 2 3 4 5 6; do
  if curl -fsSL http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "Health check PASSED! Website and API are live."
    exit 0
  fi
  sleep 3
done

echo "ERROR: Health check did not pass within 18 seconds. Check logs via: sudo docker compose logs app"
echo "To restore the pre-update database snapshot if needed:"
echo "  sudo docker exec shakti-app npx tsx scripts/db_backup_restore.ts restore ${BACKUP_PATH}"
exit 1
