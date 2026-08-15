#!/usr/bin/env bash
# Creates the least-privilege IAM user the backend uses to presign S3 uploads,
# then writes its access key into deploy/secrets/.env.production.
#
#   ./deploy/create-app-iam-user.sh
#
# The app cannot use an EC2 instance role today because UploadsService only
# builds an S3 client when AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are both
# set (see src/modules/uploads/uploads.service.ts).
set -euo pipefail

USER_NAME="uniride-app-prod"
POLICY_NAME="uniride-uploads-access"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$HERE/secrets/.env.production"

export AWS_PAGER=""
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }

if aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
  log "IAM user $USER_NAME already exists"
else
  log "Creating IAM user $USER_NAME"
  aws iam create-user --user-name "$USER_NAME" \
    --tags Key=Project,Value=uniride >/dev/null
fi

log "Attaching inline policy $POLICY_NAME"
aws iam put-user-policy --user-name "$USER_NAME" --policy-name "$POLICY_NAME" \
  --policy-document "file://$HERE/iam/app-s3-policy.json"

EXISTING=$(aws iam list-access-keys --user-name "$USER_NAME" \
  --query 'AccessKeyMetadata[].AccessKeyId' --output text)
if [ -n "$EXISTING" ]; then
  echo
  echo "This user already has access key(s): $EXISTING"
  echo "AWS never shows a secret twice, so a new key is needed to populate .env.production."
  read -r -p "Delete the existing key(s) and issue a fresh one? [y/N] " ANSWER
  [[ "$ANSWER" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }
  for K in $EXISTING; do aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$K"; done
fi

log "Creating access key"
CREDS=$(aws iam create-access-key --user-name "$USER_NAME" \
  --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text)
KEY_ID=$(echo "$CREDS" | cut -f1)
SECRET=$(echo "$CREDS" | cut -f2)

sed -i "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=$KEY_ID|" "$ENV_FILE"
sed -i "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=$SECRET|" "$ENV_FILE"

log "Wrote credentials for $KEY_ID into deploy/secrets/.env.production"
echo "Run ./deploy/deploy.sh to push them to the server."
