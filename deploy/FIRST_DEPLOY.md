# First deploy to AWS

How the production backend was stood up, from an AWS account with nothing in it
to a running server. Written as a record of what was actually done, so that
rebuilding the stack from scratch — a new account, a new region, a second
environment — is a matter of following it again rather than rediscovering it.

For routine deploys after a code change, see [REDEPLOY.md](REDEPLOY.md). This
file is only for the first time.

---

## 1. What gets built

One EC2 host running four containers under Docker Compose. Only Caddy is
reachable from the internet; it terminates TLS and forwards inward. Postgres and
Redis publish no ports at all and are reachable only on the internal bridge
network.

```
              Internet
                 │  :80 / :443
    ┌────────────▼─────────────┐
    │ EC2 t3.small             │  Elastic IP, so the hostname is stable
    │ Ubuntu 24.04, 30 GB gp3  │
    │                          │
    │   caddy ──▶ app :3000    │  Let's Encrypt, auto-renewing
    │              ├─ postgres │  16-alpine, EBS-backed volume
    │              └─ redis    │  7-alpine, AOF persistence
    └──────────────────────────┘
                 │
        S3 uniride-uploads-prod    private, SSE-S3
```

Region is **ap-southeast-1** (Singapore) — the closest to Dhaka with full
service coverage. Roughly **$19/month**: $15.20 instance, $2.75 disk, under a
dollar of S3. The Elastic IP is free while attached to a running instance and
billed if you leave it allocated after tearing the instance down.

### Why sslip.io

The host answers on `api-<dashed-ip>.sslip.io`, derived from its own Elastic IP.
[sslip.io](https://sslip.io) resolves any dashed-IP hostname back to that IP, so
there is no domain to buy and no DNS to configure, and the Let's Encrypt HTTP-01
challenge succeeds on first boot. It is a real hostname with a real certificate,
which is enough to develop and pilot against. Swap `DOMAIN` in
`secrets/.env.production` for a purchased domain before launch.

---

## 2. Two IAM users, two jobs

Neither of these is a person's account, and neither can do anything outside this
project.

| User | Used by | Can do |
|---|---|---|
| `uniride-deployer` | you, from your laptop | create and manage the EC2 host; create the app user |
| `uniride-app-prod` | the NestJS process on the server | read/write the uploads bucket, nothing else |

`uniride-deployer` is created by hand, once, in the console. It deliberately
cannot create itself: `iam/deployer-policy.json` scopes its IAM permissions to
`user/uniride-app-*`, so a leaked deploy key cannot mint a new administrator.

`uniride-app-prod` is created by `create-app-iam-user.sh`, which the deployer
*can* do. The app needs static keys rather than an EC2 instance role because
`UploadsService` only constructs an S3 client when `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY` are both set.

### Creating the deployer user

Signed in as root or an administrator:

1. **IAM → Users → Create user**, name `uniride-deployer`, console access
   **unchecked** — it never logs into a browser.
2. On **Set permissions**, attach nothing and continue. That screen only lists
   policies that already exist, so searching it for a policy you have not created
   is a dead end.
3. Create the user, open it, then **Permissions → Add permissions → Create
   inline policy → JSON**, and paste `iam/deployer-policy.json` whole. Name it
   `uniride-deployer-access`.
4. **Security credentials → Create access key → Command Line Interface.** The
   secret is shown exactly once.

An inline policy rather than a managed one, because nothing else will ever reuse
these permissions and it removes a step.

### Pointing the CLI at it

```bash
aws configure --profile uniride     # key, secret, ap-southeast-1, json
export AWS_PROFILE=uniride
export AWS_REGION=ap-southeast-1
```

Verify before going further — the second command is the real test, because it
proves the inline policy actually saved:

```bash
aws sts get-caller-identity                                   # .../uniride-deployer
aws ec2 describe-vpcs --query 'Vpcs[0].VpcId' --output text    # vpc-...
```

`export` lives only in that shell. A new terminal silently falls back to your
default profile and the scripts fail with `UnauthorizedOperation`, which reads
like a permissions problem and is not. Put `export AWS_PROFILE=uniride` in your
shell profile.

---

## 3. The three scripts

```bash
cd uniride_v2_backend
./deploy/provision-ec2.sh        # ~2 min  — key pair, security group, instance, Elastic IP
./deploy/create-app-iam-user.sh  # ~10 sec — the app's S3 user, written into .env.production
./deploy/deploy.sh               # ~5 min  — sync, build, migrate, start, health-check
```

All three are idempotent. A run that dies partway can be re-run; each step
checks for what it would create and reuses it.

**`provision-ec2.sh`** resolves the current patched Ubuntu 24.04 AMI from SSM
rather than hardcoding a stale image id, requires IMDSv2, encrypts the root
volume, and writes `secrets/host.env` plus the `DOMAIN` line in
`secrets/.env.production`. Everything downstream reads those.

**`create-app-iam-user.sh`** is the one script to run *once*. AWS never shows a
secret twice, so re-running it must delete the existing key to issue a new one —
it prompts before doing that. If you do rotate the key, run `deploy.sh` again to
push it to the server or uploads start failing.

**`deploy.sh`** ships the working tree, not a git ref. See
[REDEPLOY.md](REDEPLOY.md) for what that means in practice.

---

## 4. What was provisioned

Recorded here because `secrets/host.env` is gitignored and this is the only
committed copy.

| | |
|---|---|
| Account | `444158823569` |
| Region | `ap-southeast-1` |
| Instance | `i-0f25c559cba304b1e` (t3.small) |
| Security group | `sg-05fb3f2a0bbd5b1d6` |
| Elastic IP | `18.138.192.189` |
| Hostname | `api-18-138-192-189.sslip.io` |
| Bucket | `uniride-uploads-prod` |

Health lives at **`/api/v1/health`**, not `/api/health` — every route is
versioned. Swagger is at `/api/docs`.

```bash
source deploy/secrets/host.env
curl https://$DOMAIN/api/v1/health
```

The certificate is issued on first boot, so allow ~30 seconds after the first
deploy before a TLS warning means anything.

Point the app at it with:

```bash
cd ../uniride_v2_app
flutter run --dart-define=API_ORIGIN=https://api-18-138-192-189.sslip.io
```

That replaces the `adb reverse` USB tunnel entirely.

---

## 5. Two bugs found doing this

Both are fixed in the scripts; noted so a future reader does not assume their
own setup is at fault if something similar appears.

**`iam:TagUser` was missing from the deployer policy.**
`create-app-iam-user.sh` passes `--tags` to `iam:CreateUser`, which AWS
authorises as a separate `iam:TagUser` action. Without it the first deploy fails
at step two with `AccessDenied`. Fixed in `710c8a4`.

**A non-ASCII character in the security group description.**
`CreateSecurityGroup` rejects anything outside ASCII in `GroupDescription`, and
the description contained an em-dash. The key pair is created before this point,
so the failed run left a half-provisioned account behind. Fixed in `e115181`.

---

## 6. SSH access drifts

`provision-ec2.sh` opens port 22 to the deploying machine's public IP alone, and
nothing else. That is the right default — the alternative is exposing SSH to the
internet — but a consumer ISP hands out rotating addresses, so it stops working
without warning. The symptom is `deploy.sh` hanging on *"Waiting for cloud-init
to finish"* and eventually timing out, which does not look like a firewall
problem.

`allow-ssh.sh` handles it:

```bash
./deploy/allow-ssh.sh          # this exact address
./deploy/allow-ssh.sh --pool   # the surrounding /24, if a /32 keeps failing
./deploy/allow-ssh.sh --list   # what is currently allowed
./deploy/allow-ssh.sh --prune  # drop the stale rules that accumulate
```

Some ISPs egress one machine from several addresses in a pool, so a `/32` that
works one minute fails the next — `checkip.amazonaws.com` reports whichever one
answered *that* request, which is not necessarily the one your SSH packets leave
from. That is what happened here, and it is why `--pool` exists. A `/24` of one
ISP's customers, against key-only SSH with no password auth, is the usual trade.
Narrow it again with `--prune` from a stable network.

---

## 7. Secrets

`secrets/.env.production` holds the **only copy** of the production JWT signing
key and the AES-256-GCM key used for PII columns. Lose it and every issued token
is invalidated and encrypted personal data becomes permanently unreadable. The
directory is gitignored, so the repository is not a backup — keep an offline
copy before the first deploy, not after.

---

## 8. Known gaps at first deploy

None of these block a pilot; all of them should be closed before real users.

**Reading uploaded files returns 403.** The bucket is private and
`UploadsService` presigns only *uploads*, so the `publicUrl` it stores is not
readable. Uploading works; displaying the file back does not. The fix is a
presigned-GET endpoint — the right approach anyway for licence and ID documents,
which are sensitive PII. Application work, not infrastructure.

**`GOOGLE_MAPS_API_KEY` is unset**, so place search falls back to the static
Dhaka area list instead of live lookups.

**Firebase, Resend and Sentry are unset**, so there are no push notifications,
no transactional email, and no error reporting. The app degrades gracefully
without them, but you are flying blind on production errors.

**One host, no redundancy.** If the instance dies the API is down until it is
restored. Acceptable for a pilot, provided the database backup in
[REDEPLOY.md](REDEPLOY.md) is actually being taken.
