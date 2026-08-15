# AWS deployment

Single EC2 host in **ap-southeast-1** running the whole stack under Docker
Compose, with Caddy terminating TLS.

```
                 Internet
                    │  :80 / :443
          ┌─────────▼──────────┐
          │  EC2 t3.small      │   Elastic IP → api-<ip>.sslip.io
          │  Ubuntu 24.04      │
          │  ┌──────────────┐  │
          │  │ caddy        │  │  Let's Encrypt, auto-renewing
          │  │   ▼          │  │
          │  │ app :3000    │  │  NestJS (prod image)
          │  │   ├─ postgres│  │  16-alpine, EBS-backed volume
          │  │   └─ redis   │  │  7-alpine, AOF persistence
          │  └──────────────┘  │
          └────────────────────┘
                    │
              S3 uniride-uploads-prod (private, SSE-S3)
```

Only Caddy is exposed. Postgres and Redis have no published ports and are
reachable only on the internal Docker network.

## Files

| File | Purpose |
|---|---|
| `provision-ec2.sh` | Creates key pair, security group, instance, Elastic IP. Idempotent. |
| `bootstrap.sh` | EC2 user-data: Docker, Compose, 2 GB swap, unattended upgrades. |
| `deploy.sh` | Syncs the working tree, rebuilds, restarts, waits for health. Normal redeploy path. |
| `create-app-iam-user.sh` | Creates the least-privilege IAM user for S3 presigning. |
| `docker-compose.prod.yml` | The production stack. |
| `Caddyfile` | TLS + reverse proxy, WebSocket-safe. |
| `iam/deployer-policy.json` | Permissions the deploying principal needs. |
| `iam/app-s3-policy.json` | Permissions the running app needs (S3 only). |
| `secrets/` | Generated keys and `.env.production`. **Gitignored — never commit.** |

## First-time deploy

```bash
export AWS_REGION=ap-southeast-1
./deploy/provision-ec2.sh        # ~2 min, prints the public IP + hostname
./deploy/create-app-iam-user.sh  # writes S3 credentials into .env.production
./deploy/deploy.sh               # ~5 min on first run (image build)
```

## Redeploy after a code change

```bash
./deploy/deploy.sh
```

Prisma migrations run automatically as the app container starts. A failed
migration exits non-zero and the old container keeps serving until it is fixed.

## Operating

```bash
source deploy/secrets/host.env
SSH="ssh -i deploy/secrets/uniride-backend-key.pem ubuntu@$PUBLIC_IP"

$SSH 'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml logs -f app'
$SSH 'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml ps'
$SSH 'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml restart app'
```

Database backup:

```bash
$SSH 'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U uniride uniride' | gzip > backup-$(date +%F).sql.gz
```

## Secrets

`secrets/.env.production` holds the only copy of the production JWT signing key
and PII encryption key. If it is lost, every issued token is invalidated and
encrypted PII columns become unreadable. Keep an offline copy of `secrets/`.

## Cost

| Item | Monthly |
|---|---|
| t3.small (on-demand) | ~$15.20 |
| 30 GB gp3 EBS | ~$2.75 |
| Elastic IP (attached) | $0.00 |
| S3 + requests (low volume) | <$1 |
| **Total** | **~$19** |

## Known gap: reading uploaded files

The bucket is private and `UploadsService` only presigns **uploads**. The
`publicUrl` it stores (`AWS_CLOUDFRONT_URL/<key>`) will return 403 on read.
Uploads work; displaying them does not. Two ways to close it:

1. Add a presigned-GET endpoint and have the app fetch view URLs on demand —
   correct for licence and ID documents, which are sensitive PII.
2. Put CloudFront with an Origin Access Control in front of the bucket, and
   keep option 1 for the verification-document prefixes only.

Option 1 is the smaller change and the right default; it belongs with the app
work rather than the infrastructure.
