#!/usr/bin/env bash
# Creates the first admin on the deployed host, or resets an existing one.
#
#   ./deploy/create-admin.sh <email> <password> [name]
#   ./deploy/create-admin.sh <email> <password> [name] --super
#
# There is no other way in. Every admin route sits behind RolesGuard, the panel
# signs in through the ordinary /auth/login, and nothing in signup can hand out
# an ADMIN role -- correctly, since a self-service route to admin would undo the
# authorisation model. So the first one is made against the database directly,
# and this is that step written down rather than an ad-hoc UPDATE nobody can
# repeat.
#
# Runs entirely on the host because production Postgres publishes no ports: it
# is reachable only on the internal Docker network, which is the reason it
# cannot be attacked from the internet and also the reason this cannot be a
# local script. The hash is computed inside the app container, whose bcryptjs
# is the same one the login path verifies with.
#
# Idempotent: run it against an existing email and it resets that account's
# password and role, which is also how a locked-out admin recovers.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/secrets/host.env" ] || { echo "ERROR: run ./deploy/provision-ec2.sh first." >&2; exit 1; }
# shellcheck disable=SC1091
source "$HERE/secrets/host.env"

EMAIL="${1:-}"
PASSWORD="${2:-}"
NAME="${3:-UniRide Admin}"
ROLE=ADMIN
for arg in "$@"; do [ "$arg" = "--super" ] && ROLE=SUPER_ADMIN; done
[ "$NAME" = "--super" ] && NAME="UniRide Admin"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Usage: $0 <email> <password> [name] [--super]" >&2
  exit 1
fi
if [ "${#PASSWORD}" -lt 8 ]; then
  echo "ERROR: password must be at least 8 characters." >&2
  exit 1
fi

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
SSH=(ssh -i "$HERE/secrets/uniride-backend-key.pem" -o BatchMode=yes -o StrictHostKeyChecking=accept-new "ubuntu@$PUBLIC_IP")

log "Hashing on the host (bcrypt, 12 rounds -- matching auth.service.ts)"
# The password reaches the host over ssh on stdin rather than in the command
# line, so it never appears in `ps` output or in either machine's shell history.
HASH=$(printf '%s' "$PASSWORD" | "${SSH[@]}" 'cd /opt/uniride/deploy \
  && set -a && . ./secrets/.env.production && set +a \
  && docker compose -f docker-compose.prod.yml exec -T app \
       node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(require(\"bcryptjs\").hashSync(s,12)))"' \
  | tr -d '\r\n')

case "$HASH" in
  '$2'*) ;;
  *) echo "ERROR: did not get a bcrypt hash back. Is the app container running?" >&2; exit 1 ;;
esac

log "Upserting $ROLE $EMAIL"
# isEmailVerified is set true because an admin made this way has no inbox to
# verify from, and login refuses an unverified account.
printf '%s\n' "$HASH" | "${SSH[@]}" "cd /opt/uniride/deploy \
  && set -a && . ./secrets/.env.production && set +a \
  && HASH=\$(cat) && docker compose -f docker-compose.prod.yml exec -T postgres \
       psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -v ON_ERROR_STOP=1 \
       -v email='$EMAIL' -v name='$NAME' -v role='$ROLE' -v hash=\"\$HASH\" <<'SQL'
INSERT INTO users (id, email, name, password_hash, role, is_email_verified, created_at, updated_at)
VALUES (gen_random_uuid(), :'email', :'name', :'hash', :'role'::\"UserRole\", true, now(), now())
ON CONFLICT (email) DO UPDATE
   SET password_hash = EXCLUDED.password_hash,
       role = EXCLUDED.role,
       is_email_verified = true,
       is_suspended = false,
       suspended_reason = NULL,
       deleted_at = NULL,
       updated_at = now();

INSERT INTO user_stats (id, user_id, updated_at)
SELECT gen_random_uuid(), id, now() FROM users WHERE email = :'email'
ON CONFLICT (user_id) DO NOTHING;

SELECT email, role, is_email_verified FROM users WHERE email = :'email';
SQL"

echo
log "Sign in at the admin panel with $EMAIL"
