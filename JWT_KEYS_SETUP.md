# JWT Keys Setup (RS256) — Render

The backend signs JWTs with **RS256**, which needs a real **RSA key pair**.
Registration/login throw `secretOrPrivateKey must be an asymmetric key when
using RS256` when `JWT_PRIVATE_KEY` in Render is missing or not a valid RSA key.

No code changes are needed — this is purely an environment-variable fix.

---

## Step 1 — Generate the key pair

This creates two files (`jwt_private.pem`, `jwt_public.pem`) in the current folder.

**Windows PowerShell** (`openssl` isn't on PATH, so call Git's copy by full path):

```powershell
& "C:\Program Files\Git\usr\bin\openssl.exe" genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt_private.pem
& "C:\Program Files\Git\usr\bin\openssl.exe" rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

**Git Bash / macOS / Linux** (`openssl` is already on PATH):

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out jwt_private.pem
openssl rsa -in jwt_private.pem -pubout -out jwt_public.pem
```

- `jwt_private.pem` → used to **sign** tokens (`JWT_PRIVATE_KEY`)
- `jwt_public.pem` → used to **verify** tokens (`JWT_PUBLIC_KEY`)

> They must come from the **same run** (a matching pair).

---

## Step 2 — View the contents to copy

**Git Bash:**
```bash
cat jwt_private.pem
cat jwt_public.pem
```

**PowerShell:**
```powershell
Get-Content jwt_private.pem -Raw
Get-Content jwt_public.pem -Raw
```

Copy the **entire** output of each file, including the
`-----BEGIN ...-----` and `-----END ...-----` lines.

---

## Step 3 — Set the variables in Render

Render dashboard → your service → **Environment** → add/edit:

| Key | Value |
|-----|-------|
| `JWT_PRIVATE_KEY` | full contents of `jwt_private.pem` |
| `JWT_PUBLIC_KEY`  | full contents of `jwt_public.pem`  |

Rules:
- **Paste the multi-line PEM as-is** — Render supports multi-line values.
- **No surrounding quotes.**
- If you ever must use a single-line value, join the lines with literal `\n`
  — the backend converts `\n` back to real newlines automatically.

Save changes → Render auto-redeploys.

---

## Step 4 — Verify

After the redeploy finishes, registration should work. Quick check:

```bash
curl -s -X POST https://uniride-v2-backend.onrender.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test-'"$(date +%s)"'@example.com","password":"password123"}'
```

Expected: HTTP **201** with a JSON body containing `accessToken`
(not a 500 and not the `secretOrPrivateKey...` error).

---

## Security

- **Never commit `.pem` files.** Add this to `.gitignore`:
  ```
  *.pem
  ```
- Delete the local `.pem` files once they're set in Render, if you don't need
  them locally.
- Treat `JWT_PRIVATE_KEY` like a password.

---

## Still to do after this (separate issue)

OTP **emails won't deliver** in production until Resend is configured with a
verified sending domain: set `RESEND_FROM_EMAIL` to an address on a domain you've
verified in the Resend dashboard. Until then, signup succeeds but the code never
arrives by email (and `devOtp` is only returned when `NODE_ENV` ≠ `production`).
