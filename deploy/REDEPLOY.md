# Redeploying

Shipping a code change to the production host. This is the everyday path; for
standing the stack up the first time on a fresh account, see
[FIRST_DEPLOY.md](FIRST_DEPLOY.md).

---

## The short version

```bash
export AWS_PROFILE=uniride
cd uniride_v2_backend
./deploy/deploy.sh
```

That is the whole thing. About a minute after the first build, because Docker
reuses the cached layers. It exits non-zero if the API does not come back
healthy, and prints the logs that explain why.

---

## What it actually does

In order:

1. Waits for the host to be reachable over SSH.
2. `rsync`s the working tree to `/opt/uniride`, deleting anything on the host
   that is no longer in your tree.
3. `rsync`s `secrets/.env.production` separately, mode 0600.
4. `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`,
   then prunes dangling images so the 30 GB disk does not silently fill.
5. Polls `https://$DOMAIN/api/v1/health` every 10 seconds for 5 minutes.

Prisma migrations are not a separate step — the app container runs
`prisma migrate deploy` before `node dist/main`, every start.

### It ships your folder, not your branch

`deploy.sh` copies what is on disk. It does not read git, does not care what
branch you are on, and does not care whether you have committed. An uncommitted
experiment sitting in your editor **will** go to production.

Excluded from the sync: `.git`, `node_modules`, `dist`, `coverage`, your local
`.env`, and `deploy/secrets` — which is pushed separately so a stray `--delete`
can never wipe the production secrets off the host.

Commit and push before deploying, so that what is running can be identified
later:

```bash
git status              # nothing unexpected
git push
./deploy/deploy.sh
```

---

## Changing the database schema

Generate the migration locally, against the dev database, and commit it:

```bash
docker compose up -d                       # local stack
npx prisma migrate dev --name add_ride_rating
git add prisma/migrations prisma/schema.prisma
git commit -m "feat(api): rate a completed ride"
./deploy/deploy.sh
```

The migration is applied on the host when the new container boots. If it fails,
the container exits non-zero and Docker restarts it — so a broken migration
never serves traffic, but it also never stops trying. Watch the logs after any
schema change:

```bash
source deploy/secrets/host.env
ssh -i deploy/secrets/uniride-backend-key.pem ubuntu@$PUBLIC_IP \
  'cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml logs -f app'
```

**Never run `prisma migrate dev` against production.** It is a development
command and will offer to reset the database. The deploy path uses
`migrate deploy`, which only applies pending migrations and never drops
anything.

**Take a backup before a migration that drops or rewrites a column.** See below.

---

## Changing an environment variable

Edit `deploy/secrets/.env.production` locally, then deploy. The file is synced
on every run, so no separate step is needed:

```bash
$EDITOR deploy/secrets/.env.production
./deploy/deploy.sh
```

Adding `GOOGLE_MAPS_API_KEY`, or the Firebase/Resend/Sentry credentials, is
exactly this. Remember the file is the only copy of the JWT signing key and the
PII encryption key — edit it, never regenerate it.

---

## Rolling back

There is no rollback command. Deploy an older tree:

```bash
git log --oneline -10
git checkout <known-good-sha>
./deploy/deploy.sh
git checkout -            # back to your branch
```

**Applied migrations are not undone by this.** Schema changes stay. If the bad
deploy included a destructive migration, restore from a backup instead — which
is the reason to take one before any migration that drops data.

---

## Operating the host

Set up the shell once per session:

```bash
cd uniride_v2_backend
source deploy/secrets/host.env
SSH="ssh -i deploy/secrets/uniride-backend-key.pem ubuntu@$PUBLIC_IP"
DC="cd /opt/uniride/deploy && docker compose -f docker-compose.prod.yml"
```

Then:

```bash
$SSH "$DC logs -f app"          # follow API logs
$SSH "$DC logs --tail=100 caddy" # TLS and routing problems
$SSH "$DC ps"                    # what is running
$SSH "$DC restart app"           # restart the API alone
$SSH 'df -h /; free -m'          # disk and memory
```

### Database backup

Take one before any risky migration, and on a schedule you actually keep:

```bash
$SSH "$DC exec -T postgres pg_dump -U uniride uniride" \
  | gzip > backup-$(date +%F).sql.gz
```

Restoring, which drops the current contents:

```bash
gunzip -c backup-2026-08-29.sql.gz \
  | $SSH "$DC exec -T postgres psql -U uniride -d uniride"
```

---

## When it fails

### Hangs on "Waiting for cloud-init to finish", then times out

Your SSH access, not the server. The security group allows port 22 from the one
public IP you provisioned from, and a consumer ISP rotates that. Re-open it from
the network you are on now, then re-run the deploy:

```bash
source deploy/secrets/host.env
aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG_ID \
  --protocol tcp --port 22 --cidr $(curl -fsS https://checkip.amazonaws.com)/32
```

### UnauthorizedOperation or AccessDenied from an aws command

Check who you are before assuming the policy is wrong:

```bash
aws sts get-caller-identity
```

If it is not `uniride-deployer`, your `AWS_PROFILE` was lost — almost always a
new terminal tab. Re-export it.

### Health check never returns 200

The script prints the last 80 lines of the app and Caddy logs on failure. In
rough order of likelihood:

- A migration failed and the app container is restarting in a loop. The Prisma
  error is in the app logs.
- A required environment variable is missing from `.env.production`, so config
  validation refuses to boot. Also in the app logs.
- Caddy could not get a certificate. It needs port **80** open to the whole
  internet for the ACME challenge, not just 443.

### Build runs out of memory

The host is a 2 GB t3.small with a 2 GB swap file added at bootstrap, which is
enough for `nest build` today. If it starts failing as dependencies grow, resize
the instance rather than trimming the build:

```bash
source deploy/secrets/host.env
aws ec2 stop-instances --region $REGION --instance-ids $INSTANCE_ID
aws ec2 wait instance-stopped --region $REGION --instance-ids $INSTANCE_ID
aws ec2 modify-instance-attribute --region $REGION --instance-id $INSTANCE_ID \
  --instance-type t3.medium
aws ec2 start-instances --region $REGION --instance-ids $INSTANCE_ID
```

The Elastic IP stays attached across a stop/start, so the hostname and the
certificate survive.

### Disk filling up

`deploy.sh` prunes dangling images each run, and container logs are capped by
the compose file. If `df -h` still shows pressure, the usual culprit is old
build cache:

```bash
$SSH 'docker system prune -af --volumes'
```

`--volumes` will delete **unused** volumes. `postgres_data`, `redis_data` and
`caddy_data` are in use by running containers and are not touched — but do not
run this while the stack is down.

---

## Deploying the app, not the backend

The Flutter app is a separate repository and does not go through this script.
Point a build at production with:

```bash
cd ../uniride_v2_app
flutter build apk --dart-define=API_ORIGIN=https://api-18-138-192-189.sslip.io
```

The origin defaults to `http://localhost:3000` when the define is omitted, which
is what the local `dev.sh` flow relies on. There is no environment switching
inside the app — the value is compiled in.
