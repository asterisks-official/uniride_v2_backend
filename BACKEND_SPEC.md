# UniRide Backend — Project Specification & Implementation Plan

## Overview

The UniRide backend is a **NestJS REST API + Socket.IO real-time server** that powers the entire UniRide platform. It handles authentication, ride lifecycle management, real-time tracking, chat, notifications, ratings, and admin operations. It is consumed by the Flutter mobile app and the Next.js admin dashboard.

- **Base URL**: `https://api.uniride.app/api/v1`
- **Local Dev**: `http://localhost:3000/api/v1`
- **Swagger Docs**: `http://localhost:3000/api/docs`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 (TypeScript strict) |
| Database | PostgreSQL 16 via Prisma v7 ORM |
| Cache / Pub-Sub | Redis 7 (ioredis) |
| Job Queue | BullMQ (Redis-backed) |
| Real-time | Socket.IO 4 with Redis adapter |
| Auth | JWT RS256 (asymmetric), Passport.js |
| File Storage | AWS S3 + CloudFront CDN |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| Email | SendGrid |
| Maps | Google Maps API |
| Error Tracking | Sentry |
| Validation | class-validator + class-transformer |
| API Docs | Swagger (@nestjs/swagger) |
| Testing | Jest (unit) + Supertest (e2e) |
| CI/CD | GitHub Actions → Docker → Railway |

---

## Project Structure

```
uniride-backend/
├── src/
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/
│   │   │   │   └── jwt.strategy.ts
│   │   │   ├── guards/
│   │   │   │   └── jwt-auth.guard.ts
│   │   │   ├── dto/
│   │   │   │   ├── register.dto.ts
│   │   │   │   ├── login.dto.ts
│   │   │   │   ├── verify-otp.dto.ts
│   │   │   │   └── reset-password.dto.ts
│   │   │   └── auth.service.spec.ts
│   │   ├── users/
│   │   ├── rides/
│   │   ├── matching/
│   │   ├── chat/
│   │   ├── notifications/
│   │   ├── ratings/
│   │   ├── reports/
│   │   ├── uploads/
│   │   └── admin/
│   ├── database/
│   │   └── prisma.service.ts
│   ├── shared/
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   ├── transform.interceptor.ts
│   │   │   └── logging.interceptor.ts
│   │   ├── guards/
│   │   │   └── roles.guard.ts
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts
│   │   │   └── current-user.decorator.ts
│   │   └── utils/
│   │       ├── crypto.util.ts
│   │       ├── geo.util.ts
│   │       └── pagination.util.ts
│   ├── gateways/
│   │   └── ride.gateway.ts
│   ├── jobs/
│   │   └── processors/
│   │       ├── notification.processor.ts
│   │       ├── ride-expiry.processor.ts
│   │       └── trust-score.processor.ts
│   ├── config/
│   │   ├── configuration.ts
│   │   └── env.validation.ts
│   ├── app.module.ts
│   └── main.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

---

## Database Schema (14 Models)

### Core Models

| Model | Purpose |
|---|---|
| `User` | Accounts, roles (passenger/rider/admin/super_admin), suspension |
| `RiderProfile` | Vehicle info, license, verification status |
| `UserStats` | Rides completed, cancellations, avg rating, trust score |
| `UserDevice` | FCM tokens per device |
| `RefreshToken` | Token rotation + replay detection |
| `OtpVerification` | Email OTP (10-min TTL, max 5 attempts) |
| `Ride` | Core ride entity (offer/request, full lifecycle) |
| `RideRequest` | Join requests from passengers to riders |
| `RideMessage` | In-ride chat (7-day retention) |
| `Rating` | 1–5 stars + tags, blind reveal |
| `Notification` | In-app + push, delivery tracking |
| `Report` | Safety reports with severity levels |
| `Payment` | Payment records (Phase 2) |
| `AuditLog` | All admin actions logged |
| `AppConfig` | Key-value feature flags |

### Key Indexes

```prisma
@@index([status, scheduledAt])          // Ride feed browsing
@@index([originLat, originLng])         // Proximity pre-filter
@@index([userId, isRead, createdAt])    // Notification feed
@@index([status, severity, createdAt])  // Admin reports queue
@@index([verificationStatus])           // Admin verification queue
```

---

## API Endpoints

### Auth — `POST /api/v1/auth/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | — | Register with email, send OTP |
| POST | `/auth/verify-otp` | — | Verify OTP, receive tokens |
| POST | `/auth/login` | — | Login, receive tokens |
| POST | `/auth/refresh` | — | Rotate refresh token |
| POST | `/auth/logout` | JWT | Revoke refresh token |
| POST | `/auth/forgot-password` | — | Send reset OTP |
| POST | `/auth/reset-password` | — | Reset with OTP |

### Users — `GET|PATCH|DELETE /api/v1/users/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | JWT | Full profile + stats |
| PATCH | `/users/me` | JWT | Update profile |
| GET | `/users/:id/public` | JWT | Public profile view |
| DELETE | `/users/me` | JWT | Soft delete + queue anonymization |
| POST | `/uploads/presign` | JWT | S3 presigned URL for profile pic |

### Rides — `/api/v1/rides/*`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/rides` | JWT | Create ride offer or request |
| GET | `/rides` | JWT | Browse feed (proximity + filters) |
| GET | `/rides/active` | JWT | Current matched/in-progress ride |
| GET | `/rides/history` | JWT | Past rides (paginated) |
| GET | `/rides/:id` | JWT | Single ride detail |
| POST | `/rides/:id/requests` | JWT | Send join request |
| PATCH | `/rides/:id/requests/:reqId` | JWT | Accept or decline request |
| POST | `/rides/:id/start` | JWT | Start ride |
| POST | `/rides/:id/confirm-completion` | JWT | Confirm ride completed |
| POST | `/rides/:id/cancel` | JWT | Cancel ride |

### Chat, Notifications, Ratings, Reports

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/rides/:id/messages` | JWT | Chat history (paginated, 7-day) |
| GET | `/notifications` | JWT | Notification list |
| PATCH | `/notifications/:id/read` | JWT | Mark as read |
| PATCH | `/notifications/read-all` | JWT | Mark all read |
| POST | `/ratings` | JWT | Submit rating after ride |
| GET | `/users/:id/ratings` | JWT | User's ratings |
| POST | `/reports` | JWT | Submit safety report |

### Admin — `/api/v1/admin/*` (ADMIN role required)

| Method | Path | Description |
|---|---|---|
| GET | `/admin/verifications` | Pending verification queue |
| PATCH | `/admin/verifications/:id` | Approve or reject |
| GET | `/admin/reports` | Reports queue |
| PATCH | `/admin/reports/:id` | Resolve / dismiss report |
| GET | `/admin/users` | Search users |
| PATCH | `/admin/users/:id/suspend` | Suspend / unsuspend |
| GET | `/admin/config` | Get app config |
| PATCH | `/admin/config` | Update app config |
| GET | `/admin/analytics` | Aggregate stats |
| GET | `/admin/audit-log` | Admin action log |

---

## Response Envelope

All responses follow this structure:

```json
// Success
{
  "data": { ... },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" },
  "pagination": { "page": 1, "limit": 20, "total": 100 }  // list endpoints only
}

// Error
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["email must be a valid email"],
  "timestamp": "ISO8601",
  "requestId": "uuid"
}
```

---

## Architecture Patterns

### Module Structure (every module follows this)

```
module/
├── module.module.ts        → imports, providers, exports
├── module.controller.ts    → HTTP routes, DTOs, Swagger decorators
├── module.service.ts       → Business logic
├── module.repository.ts    → Prisma queries only
├── dto/
│   ├── create-x.dto.ts
│   └── update-x.dto.ts
└── module.service.spec.ts  → Unit tests (mock repository)
```

### Code Patterns

```typescript
// Controller — thin, only routing + DTO binding
@Post()
@UseGuards(JwtAuthGuard)
async create(@Body() dto: CreateRideDto, @CurrentUser() user: JwtPayload) {
  return this.ridesService.create(user.sub, dto);
}

// Service — business logic, calls repository
async create(userId: string, dto: CreateRideDto): Promise<Ride> {
  const ride = await this.ridesRepository.create({ ...dto, riderId: userId });
  await this.notificationsService.send({ ... });
  return ride;
}

// Repository — Prisma only, no business logic
async create(data: Prisma.RideCreateInput): Promise<Ride> {
  return this.prisma.ride.create({ data });
}
```

### JWT Flow (RS256)

```
Register → OTP verify → issue accessToken (15min) + refreshToken (30d)
Request → Bearer accessToken → JwtStrategy validates with PUBLIC key
401 → client calls /auth/refresh → new pair issued, old refresh revoked
Replay detected → ALL user sessions revoked
```

### BullMQ Queues

| Queue | Trigger | Processor |
|---|---|---|
| `notifications` | Any notification event | FCM API call + mark delivered |
| `ride-expiry` | Ride created | Check after 30min, expire if unmatched |
| `trust-score` | Rating submitted | Recalculate UserStats.trustScore |
| `ride-completion` | Ride started | Auto-complete after 2h if no confirm |
| `anonymization` | Account deleted | Delete PII after 30 days |

### Socket.IO Rooms & Events

```
Rooms:
  ride:{rideId}     → both rider and passenger
  user:{userId}     → personal notifications
  area:{gridCell}   → feed live updates (subscribe_area)

Client → Server:
  location_update   → { lat, lng }  (every 5s during active ride)
  message           → { rideId, content }
  sos               → { rideId }
  subscribe_area    → { lat, lng }

Server → Client:
  location_update   → broadcast to ride:{rideId}
  message           → broadcast to ride:{rideId}
  ride_status       → { status } broadcast on any status change
  notification      → personal event to user:{userId}
```

---

## Security Implementation

| Concern | Implementation |
|---|---|
| Password hashing | bcrypt cost factor 12 |
| PII encryption | AES-256-GCM (phone, student ID) |
| JWT signing | RS256 asymmetric — private key on API only |
| Refresh rotation | Old token revoked on each refresh |
| Replay detection | Revoke all sessions on reuse |
| Rate limiting | Redis ThrottlerGuard: 100 req/min auth, 30/min IP |
| RBAC | RolesGuard — passenger / rider / admin / super_admin |
| Input validation | class-validator whitelist + forbidNonWhitelisted |
| SQL injection | Prisma parameterized queries (no raw SQL) |
| CORS | Whitelist production origins only |
| Transport | TLS 1.3+ enforced via Railway / Cloudflare |

---

## Implementation Phases

### Phase 1 — Skeleton (Week 3–4)
- [ ] Create all 10 NestJS modules with empty controllers/services/repositories
- [ ] Create `PrismaService` (singleton, onModuleInit connect)
- [ ] Create `PrismaModule` (global)
- [ ] Create global `HttpExceptionFilter`
- [ ] Create `TransformInterceptor` (response envelope + requestId)
- [ ] Create `LoggingInterceptor`
- [ ] Create `RolesGuard` + `@Roles()` decorator
- [ ] Create `@CurrentUser()` decorator
- [ ] Create `JwtStrategy` (RS256, reads public key from config)
- [ ] Create `JwtAuthGuard`
- [ ] Setup BullMQ module with all 4 queues
- [ ] Setup Socket.IO gateway skeleton with Redis adapter
- [ ] Wire `AppModule` with all modules, config, throttler
- [ ] Run first Prisma migration: `npm run db:migrate`

### Phase 2 — Auth (Week 5–6)
- [ ] `POST /auth/register` — bcrypt hash, AES encrypt phone, create User + UserStats, send OTP via SendGrid
- [ ] `POST /auth/verify-otp` — validate hash + TTL + attempts, mark email verified, issue RS256 tokens
- [ ] `POST /auth/login` — bcrypt compare, issue tokens, save RefreshToken + UserDevice
- [ ] `POST /auth/refresh` — validate hash, detect replay, rotate token pair
- [ ] `POST /auth/logout` — soft revoke refresh token
- [ ] `POST /auth/forgot-password` + `POST /auth/reset-password`
- [ ] `OtpService` — generate 6-digit, hash with crypto, enforce 5-attempt limit via Redis
- [ ] `TokenService` — sign/verify RS256, rotation, revocation
- [ ] `GET /users/me`, `PATCH /users/me`, `GET /users/:id/public`, `DELETE /users/me`
- [ ] `POST /uploads/presign` — S3 presigned URL + CloudFront URL response
- [ ] Unit tests for all auth flows

### Phase 3 — Rides (Week 7–10)
- [ ] `POST /rides` — create with validation (type, locations, fare, seats, scheduledAt)
- [ ] `GET /rides` — proximity filter via lat/lng index, Redis cache 30s TTL, pagination
- [ ] `GET /rides/:id`, `GET /rides/active`, `GET /rides/history`
- [ ] `POST /rides/:id/requests` — duplicate check, ride status check
- [ ] `PATCH /rides/:id/requests/:reqId` — accept (update ride status → matched) / decline
- [ ] `POST /rides/:id/start` — status → in_progress, notify passenger
- [ ] `POST /rides/:id/confirm-completion` — both confirm → completed, trigger rating prompt
- [ ] `POST /rides/:id/cancel` — update cancellation stats
- [ ] Ride expiry BullMQ job (30-min delayed)
- [ ] Auto-complete BullMQ job (2-hour delayed)
- [ ] Matching score calculation in `MatchingService`
- [ ] `POST /ratings` — blind reveal logic, enqueue trust-score recalculation
- [ ] `GET /users/:id/ratings`
- [ ] Trust score formula: `(avgRating×40) + (completionRate×30) + (experience×20) + (accountAge×10)`
- [ ] Unit tests for rides and matching

### Phase 4 — Real-time (Week 11–12)
- [ ] `RideGateway` — JWT auth in handshake, auto-join rooms on connect
- [ ] `location_update` handler — validate, store in Redis GEO, broadcast
- [ ] `message` handler — save RideMessage, broadcast to room
- [ ] `sos` handler — flag ride, notify admin room
- [ ] `subscribe_area` / `unsubscribe_area` — area room management
- [ ] `ride_status` broadcast on all status changes
- [ ] System messages on: request accepted, ride started, ride completed
- [ ] `NotificationsModule` — FCM via BullMQ, delivery tracking
- [ ] `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`
- [ ] `GET /rides/:id/messages` — paginated, 7-day filter
- [ ] Scheduled job: delete messages older than 7 days

### Phase 5 — Admin (Week 13–14)
- [ ] All 10 admin endpoints with `RolesGuard([ADMIN, SUPER_ADMIN])`
- [ ] `AuditLogService` — write on every admin action
- [ ] Analytics aggregation queries

### Phase 6 — Reports (Week 13)
- [ ] `POST /reports` — create report, auto-FCM-notify admin on CRITICAL
- [ ] `GET /reports/mine`

### Phase 7 — Optimize (Week 15–16)
- [ ] Redis caching layer for ride feed (cache-aside pattern)
- [ ] Integration tests (real Postgres + Redis via docker-compose)
- [ ] k6 load test: P99 < 200ms at 500 concurrent users
- [ ] `npm audit` + Snyk security scan
- [ ] Prometheus metrics endpoint
- [ ] PgBouncer connection pooling config

---

## Coding Standards

```typescript
// DTOs — always use class-validator
export class CreateRideDto {
  @IsString() @IsNotEmpty()
  originAddress: string;

  @IsNumber() @Min(-90) @Max(90)
  originLat: number;

  @IsEnum(RideType)
  type: RideType;
}

// No `any` — ever
// Explicit return types on all public methods
// Repository pattern — no Prisma calls in services
// All env vars validated by Joi at startup
// Conventional commits enforced by Commitlint
```

---

## Environment Variables

See `.env.example` for the full list. Required for local dev:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/uniride_dev
REDIS_URL=redis://localhost:6379
JWT_PRIVATE_KEY=<RS256 private key>
JWT_PUBLIC_KEY=<RS256 public key>
ENCRYPTION_KEY=<32 bytes hex>
```

Generate RSA keys:
```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Start local infrastructure:
```bash
docker-compose up -d
npm run db:migrate
npm run start:dev
```

---

## Testing Strategy

```
Unit tests   → 70% — Jest, mock PrismaService and external services
Integration  → 20% — real Postgres + Redis, Supertest HTTP calls
Load tests   → 10% — k6, target P99 < 200ms, error rate < 1%
```

Run tests:
```bash
npm run test          # unit
npm run test:cov      # with coverage
npm run test:e2e      # e2e
```
