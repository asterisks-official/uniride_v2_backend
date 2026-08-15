#!/usr/bin/env bash
# Provisions the UniRide backend host: security group, key pair, EC2 instance,
# Elastic IP. Idempotent — re-running reuses anything that already exists.
#
#   ./deploy/provision-ec2.sh
#
# Requires AWS credentials with the permissions in deploy/iam/deployer-policy.json.
set -euo pipefail

REGION="${AWS_REGION:-ap-southeast-1}"
NAME="uniride-backend"
INSTANCE_TYPE="${INSTANCE_TYPE:-t3.small}"
VOLUME_SIZE_GB=30
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY_PATH="$HERE/secrets/${NAME}-key.pem"

export AWS_PAGER=""
aws() { command aws --region "$REGION" "$@"; }
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

# ─── Key pair ────────────────────────────────────────────────────────────────
if aws ec2 describe-key-pairs --key-names "$NAME" >/dev/null 2>&1; then
  log "Key pair $NAME already exists"
  [ -f "$KEY_PATH" ] || { echo "ERROR: key pair exists in AWS but $KEY_PATH is missing." >&2; exit 1; }
else
  log "Creating key pair $NAME"
  umask 077
  aws ec2 create-key-pair --key-name "$NAME" \
    --query 'KeyMaterial' --output text > "$KEY_PATH"
  chmod 400 "$KEY_PATH"
fi

# ─── Networking ──────────────────────────────────────────────────────────────
VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)
[ "$VPC_ID" = "None" ] && { echo "ERROR: no default VPC in $REGION." >&2; exit 1; }
log "Using default VPC $VPC_ID"

SG_ID=$(aws ec2 describe-security-groups \
  --filters Name=group-name,Values="$NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" = "None" ]; then
  log "Creating security group $NAME"
  SG_ID=$(aws ec2 create-security-group --group-name "$NAME" \
    --description "UniRide backend — HTTP/HTTPS public, SSH restricted" \
    --vpc-id "$VPC_ID" --query 'GroupId' --output text)

  # 80 is required for the Let's Encrypt HTTP-01 challenge, not just redirects.
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTP + ACME challenge"}]' \
      'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTPS + WebSocket"}]' >/dev/null

  MY_IP=$(curl -fsS https://checkip.amazonaws.com | tr -d '\n')
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=${MY_IP}/32,Description=\"SSH from deployer\"}]" >/dev/null
  log "SSH locked to ${MY_IP}/32 — re-run scripts/allow-ssh.sh if your IP changes"
else
  log "Security group $SG_ID already exists"
fi

# ─── Instance ────────────────────────────────────────────────────────────────
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values="$NAME" "Name=instance-state-name,Values=pending,running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "None")

if [ "$INSTANCE_ID" = "None" ]; then
  # Canonical's official Ubuntu 24.04 LTS AMI, resolved from SSM so it is
  # always the current patched image rather than a hardcoded stale ID.
  AMI_ID=$(aws ssm get-parameters \
    --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameters[0].Value' --output text)
  log "Launching $INSTANCE_TYPE from $AMI_ID"

  INSTANCE_ID=$(aws ec2 run-instances \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$NAME" \
    --security-group-ids "$SG_ID" \
    --user-data "file://$HERE/bootstrap.sh" \
    --block-device-mappings "[{\"DeviceName\":\"/dev/sda1\",\"Ebs\":{\"VolumeSize\":$VOLUME_SIZE_GB,\"VolumeType\":\"gp3\",\"Encrypted\":true,\"DeleteOnTermination\":true}}]" \
    --metadata-options "HttpTokens=required,HttpEndpoint=enabled" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=uniride}]" \
    --query 'Instances[0].InstanceId' --output text)

  log "Waiting for $INSTANCE_ID to reach running"
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
else
  log "Instance $INSTANCE_ID already exists"
  STATE=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)
  if [ "$STATE" = "stopped" ]; then
    log "Starting stopped instance"
    aws ec2 start-instances --instance-ids "$INSTANCE_ID" >/dev/null
    aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
  fi
fi

# ─── Elastic IP — keeps the sslip.io hostname and TLS cert stable ────────────
ALLOC_ID=$(aws ec2 describe-addresses --filters Name=tag:Name,Values="$NAME" \
  --query 'Addresses[0].AllocationId' --output text 2>/dev/null || echo "None")

if [ "$ALLOC_ID" = "None" ]; then
  log "Allocating Elastic IP"
  ALLOC_ID=$(aws ec2 allocate-address --domain vpc \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME}]" \
    --query 'AllocationId' --output text)
fi

CURRENT_ASSOC=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].InstanceId' --output text)
if [ "$CURRENT_ASSOC" != "$INSTANCE_ID" ]; then
  log "Associating Elastic IP with $INSTANCE_ID"
  aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id "$ALLOC_ID" >/dev/null
fi

PUBLIC_IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' --output text)
DOMAIN="api-$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"

# ─── Record the hostname for compose + the deploy script ─────────────────────
ENV_FILE="$HERE/secrets/.env.production"
if grep -q '^DOMAIN=' "$ENV_FILE"; then
  sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN|" "$ENV_FILE"
else
  echo "DOMAIN=$DOMAIN" >> "$ENV_FILE"
fi

cat > "$HERE/secrets/host.env" <<EOF
INSTANCE_ID=$INSTANCE_ID
PUBLIC_IP=$PUBLIC_IP
DOMAIN=$DOMAIN
SG_ID=$SG_ID
REGION=$REGION
EOF

cat <<EOF

┌─────────────────────────────────────────────────────────────
│ Instance : $INSTANCE_ID ($INSTANCE_TYPE)
│ Public IP: $PUBLIC_IP
│ Hostname : $DOMAIN
│ SSH      : ssh -i $KEY_PATH ubuntu@$PUBLIC_IP
│ API      : https://$DOMAIN/api/v1
└─────────────────────────────────────────────────────────────

Next: ./deploy/deploy.sh
EOF
