#!/usr/bin/env bash
# Ships the current working tree to the EC2 host and (re)starts the stack.
# Safe to run repeatedly — this is the normal redeploy path.
#
#   ./deploy/deploy.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
KEY_PATH="$HERE/secrets/uniride-backend-key.pem"
REMOTE_DIR=/opt/uniride

[ -f "$HERE/secrets/host.env" ] || { echo "ERROR: run ./deploy/provision-ec2.sh first." >&2; exit 1; }
# shellcheck disable=SC1091
source "$HERE/secrets/host.env"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
SSH=(ssh -i "$KEY_PATH" -o StrictHostKeyChecking=accept-new "ubuntu@$PUBLIC_IP")

log "Waiting for cloud-init to finish on $PUBLIC_IP"
for i in $(seq 1 60); do
  if "${SSH[@]}" 'test -f /var/lib/uniride-bootstrap-complete' 2>/dev/null; then
    log "Host ready"; break
  fi
  [ "$i" = 60 ] && { echo "ERROR: bootstrap did not complete in 10 min." >&2; exit 1; }
  sleep 10
done

log "Syncing source to $REMOTE_DIR"
# Everything the Docker build needs, and nothing else. secrets/ is synced
# separately below so a stray --delete can never wipe it.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'coverage' \
  --exclude '.env' \
  --exclude 'deploy/secrets' \
  -e "ssh -i $KEY_PATH -o StrictHostKeyChecking=accept-new" \
  "$ROOT/" "ubuntu@$PUBLIC_IP:$REMOTE_DIR/"

log "Syncing secrets (0600)"
"${SSH[@]}" "mkdir -p $REMOTE_DIR/deploy/secrets && chmod 700 $REMOTE_DIR/deploy/secrets"
rsync -az --chmod=F600 \
  -e "ssh -i $KEY_PATH -o StrictHostKeyChecking=accept-new" \
  "$HERE/secrets/.env.production" "ubuntu@$PUBLIC_IP:$REMOTE_DIR/deploy/secrets/.env.production"

log "Building and starting the stack (first build takes ~3-4 min)"
"${SSH[@]}" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/uniride/deploy
set -a; source ./secrets/.env.production; set +a
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
REMOTE

log "Waiting for the API to report healthy"
for i in $(seq 1 30); do
  CODE=$(curl -fsS -o /dev/null -w '%{http_code}' "https://$DOMAIN/api/v1/health" 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then
    log "Healthy: https://$DOMAIN/api/v1/health"
    curl -fsS "https://$DOMAIN/api/v1/health"; echo
    exit 0
  fi
  sleep 10
done

echo "ERROR: health check never returned 200. Recent logs:" >&2
"${SSH[@]}" 'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml logs --tail=80 app caddy'
exit 1
