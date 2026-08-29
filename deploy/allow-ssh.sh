#!/usr/bin/env bash
# Re-opens SSH from wherever you are now.
#
#   ./deploy/allow-ssh.sh          # this exact address, /32
#   ./deploy/allow-ssh.sh --pool   # the surrounding /24
#   ./deploy/allow-ssh.sh --list   # show the port 22 rules that exist
#   ./deploy/allow-ssh.sh --prune  # remove every port 22 rule except the current address
#
# provision-ec2.sh pins port 22 to the one address you provisioned from, so SSH
# stops working whenever your ISP hands you a different one. The failure does
# not look like a firewall: security groups DROP non-matching packets rather
# than refusing them, so deploy.sh simply hangs on "Waiting for cloud-init to
# finish" and eventually times out, as though the host never booted.
#
# --pool exists because some ISPs egress a single machine from several
# addresses in a pool, so a /32 that works one minute fails the next. A /24 of
# one ISP's customers, against key-only SSH, is the usual trade to make.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/secrets/host.env" ] || { echo "ERROR: run ./deploy/provision-ec2.sh first." >&2; exit 1; }
# shellcheck disable=SC1091
source "$HERE/secrets/host.env"

export AWS_PAGER=""
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

rules() {
  aws ec2 describe-security-group-rules --region "$REGION" \
    --filters Name=group-id,Values="$SG_ID" \
    --query 'SecurityGroupRules[?FromPort==`22` && !IsEgress].[SecurityGroupRuleId,CidrIpv4,Description]' \
    --output text
}

case "${1:-}" in
  --list)
    log "Port 22 rules on $SG_ID"
    rules | while read -r ID CIDR DESC; do printf '  %-24s %-20s %s\n' "$ID" "$CIDR" "$DESC"; done
    exit 0
    ;;
  --prune)
    MY_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')
    log "Keeping ${MY_IP}/32, removing every other port 22 rule"
    rules | while read -r ID CIDR _; do
      [ "$CIDR" = "${MY_IP}/32" ] && continue
      log "Revoking $CIDR"
      aws ec2 revoke-security-group-ingress --region "$REGION" \
        --group-id "$SG_ID" --security-group-rule-ids "$ID" >/dev/null
    done
    exit 0
    ;;
esac

MY_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')
if [ "${1:-}" = "--pool" ]; then
  CIDR="$(echo "$MY_IP" | cut -d. -f1-3).0/24"
  DESC="SSH from deployer ISP pool"
else
  CIDR="${MY_IP}/32"
  DESC="SSH from deployer"
fi

if rules | awk '{print $2}' | grep -qx "$CIDR"; then
  log "$CIDR already allowed on port 22"
else
  log "Allowing $CIDR on port 22"
  aws ec2 authorize-security-group-ingress --region "$REGION" --group-id "$SG_ID" \
    --ip-permissions "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${CIDR},Description=\"${DESC}\"}]" >/dev/null
fi

log "Verifying SSH to $PUBLIC_IP"
if timeout 20 ssh -i "$HERE/secrets/uniride-backend-key.pem" \
     -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes \
     "ubuntu@$PUBLIC_IP" true 2>/dev/null; then
  log "SSH works. Run ./deploy/deploy.sh"
else
  echo
  echo "Still no SSH. If this was a /32, your ISP is probably egressing from more" >&2
  echo "than one address — try:  ./deploy/allow-ssh.sh --pool" >&2
  exit 1
fi
