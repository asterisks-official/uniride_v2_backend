# UniRide Backend

NestJS 11 REST API + WebSocket server for the UniRide university ride-sharing platform.

**Stack:** NestJS · Prisma · PostgreSQL · Redis · BullMQ · Socket.IO · AWS S3 · Firebase FCM · Resend

---

## Local development (Docker)

Docker is the recommended way to run the backend locally. It spins up the app, PostgreSQL, and Redis together with hot-reload enabled.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- `.env` file in this directory (copy `.env.example` and fill in values)

### Start everything

```bash
docker compose up
```

First run builds the image (~2 min). Subsequent starts use the cache and are fast.

### Start with a fresh build

Use this after changing `package.json` or the `Dockerfile`.

```bash
docker compose up --build
```

### Stop all services

```bash
docker compose down
```

### Stop and wipe all data (PostgreSQL + Redis volumes)

```bash
docker compose down -v
```

### View logs

```bash
# all services
docker compose logs -f

# app only
docker compose logs -f app
```

### URLs

| Service    | URL                             |
|------------|---------------------------------|
| API        | http://localhost:3000/api/v1    |
| Swagger    | http://localhost:3000/api/docs  |
| Health     | http://localhost:3000/api/health|
| PostgreSQL | localhost:5433                  |
| Redis      | localhost:6380                  |

---

## Database

Migrations are applied automatically on every `docker compose up`.

### Create a new migration

```bash
docker compose exec app npx prisma migrate dev --name <migration-name>
```

### Open Prisma Studio

```bash
docker compose exec app npx prisma studio
```

### Re-generate Prisma client (after schema changes)

```bash
docker compose exec app npx prisma generate
```

---

## Running without Docker

```bash
npm install
npm run db:generate
npm run start:dev
```

Requires a local PostgreSQL instance on port 5433 and Redis on port 6380 matching the values in your `.env`.

---

## Tests

```bash
# unit tests
npm run test

# watch mode
npm run test:watch

# coverage
npm run test:cov

# e2e
npm run test:e2e
```

---

## JWT key generation

See [JWT_KEYS_SETUP.md](./JWT_KEYS_SETUP.md) for instructions on generating the RS256 key pair required by the auth module.
