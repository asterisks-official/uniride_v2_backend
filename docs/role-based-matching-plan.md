# Role-Based Matching — Plan & Progress

Status: **In progress** · Owner: backend-first, app follows · Last updated: 2026-06-19

## Decisions (locked)

1. **Role model: account-level + verification.** A user is `PASSENGER` by default and
   becomes `RIDER` only when their `RiderProfile` is **APPROVED**. (Already wired:
   `AdminService.verifyRider` flips `User.role` to `RIDER` on approve, back to `PASSENGER`
   on reject.)
2. **Marketplace: two-sided.** Passengers post `REQUEST` ("I need a ride") and see `OFFER`
   posts; drivers post `OFFER` ("I'm offering") and see `REQUEST` posts. Each side only
   sees the *other* side's posts.

In v1 a driver is strictly a driver and a passenger strictly a passenger (no dual mode).
A future "ride as passenger too" toggle is intentionally left out for now.

## The two problems being solved

1. **Feed ignores `RideType`.** `RidesService.searchRides` filters only on
   `status: 'SEARCHING'` (+ date/seats/gender/geo). Everyone sees every post. → Fixed in P3.
2. **Ownership conflates "creator" with "driver".** Every ride stores its creator in
   `riderId`, and the whole lifecycle assumes creator = driver. A passenger-created
   `REQUEST` is stored with the passenger in `riderId`, so matching/start/confirm run
   backwards. → Fixed in P2.

## Target model

- `User.role`: `PASSENGER` (default) → `RIDER` on approved `RiderProfile`. Enforced by the
  existing `RolesGuard` + `@Roles()`.
- **Ownership normalization:** add `Ride.creatorId`; make `riderId` **and** `passengerId`
  nullable. At creation only the creator's side is filled (by role); the other side fills at
  match. `riderId` therefore always means the *real driver*.

  | Post | `creatorId` | `riderId` | `passengerId` |
  |------|-------------|-----------|---------------|
  | Driver posts OFFER | driver | driver | null → filled on match |
  | Passenger posts REQUEST | passenger | null → filled on match | passenger |

- **Bidirectional matching:** a `RideRequest` is "claim the empty side". Passengers claim
  `OFFER` posts; verified drivers claim `REQUEST` posts. Accept fills the empty side → `MATCHED`.
- **Feed:** `searchRides` filters `type` to the complement of the viewer's role
  (`PASSENGER`→`OFFER`, `RIDER`→`REQUEST`), excludes own posts, `status=SEARCHING`.
- **Lifecycle** stays anchored to the actual driver (`riderId`) / passenger (`passengerId`),
  not the creator.

## Phased plan

### P1 — Role enforcement (no schema change) — DONE
- [x] `RolesGuard` + `@Roles()` exist.
- [x] `verifyRider` sets `role = RIDER` on approval (already present).
- [x] Gate `POST /rides`: `OFFER` requires `RIDER`; `REQUEST` requires `PASSENGER`.
      Enforced in `RidesService.createRide` (controller passes `user.role`).

### P2 — Ownership migration — DONE
- [x] Prisma: add `creatorId` (+ `Creator`/`CreatedRides` relation), make `riderId` nullable.
- [x] Migration `20260619162055_ride_creator_role_split` + **backfill** (`creator_id = rider_id`;
      REQUEST rows move `rider_id → passenger_id`). Applied; verified 2 existing OFFER rows.
- [x] Repoint "creator-only" guards (`update`, `cancel`, `getRideRequests`,
      `respondToRequest`) from `riderId === user` to `creatorId === user`.
- [x] Verified: only 2 rides exist (OFFER/CANCELLED), no live REQUEST rides.
- [x] Downstream nullable-`riderId` fixes: ride-completion processor + ratings service guards.

### P3 — Bidirectional matching + complementary feed — DONE
- [x] `requestRide`: validates requester's role is the complement of the post `type`;
      `acceptRequestTx(…, fillSide)` fills `passengerId` for OFFER, `riderId` for REQUEST.
- [x] `searchRides`: takes viewer `{id, role}`, filters `type` by role, excludes own `creatorId`.
- [x] Feed/detail/my-rides includes now carry `creator` (the poster) for REQUEST posts.

> Note: `RideRequest.passengerId` column is kept as-is but now means **"the requester"**
> (a passenger for OFFER posts, a driver for REQUEST posts). Renaming it is a future cleanup.

### P4 — App — DONE (core)
- [x] `Ride` model: added `type`, nullable `riderId`, `creator`, and a `poster` getter.
      `fromJson` parses `creator` (falls back to rider) so REQUEST posts show the passenger.
- [x] `ride_card.dart`: shows `ride.poster` instead of `ride.rider` (no more "Unknown" on
      driver feed).
- [x] `ride_type_screen.dart`: role-locked — drivers see "Offer a Ride", passengers see
      "Request a Ride" + a "Become a verified rider" CTA into `/verification`.
- [x] Ride detail: ownership now keyed on `creator.id` (REQUEST owners get the waiting/manage
      screen); requester button copy is type-aware ("Offer to Drive" vs "Request to Join").
      Post-match lifecycle already resolves correctly (driver = `riderId`, passenger = `passengerId`).

### P4b — Frontend polish — DONE
- [x] Home feed: role-aware empty state ("No ride requests yet" for riders / "No rides on
      offer yet" for passengers).
- [x] Ride card: type-aware — REQUEST posts show "budget" + a "Wants a ride" chip instead of
      "per seat" + seats badge.
- [x] Profile already role-aware (verified badge + "Become a Rider" → `/verification`).
- [x] Backend dev server restarted on the fresh Prisma client; app analyzes clean.

### Remaining / follow-ups (optional)
- Rename `RideRequest.passengerId` → `requesterId` (semantic cleanup; needs a migration).
- Edit-profile / notifications action items in Profile are still stubs (`onTap: () {}`).

## Risks / notes
- Migrating in-flight rides: existing matched/active rides are OFFERs with both IDs set, so
  `creatorId = riderId` backfill is safe. Confirm before running.
- Verification → role is already atomic in `verifyRider` ($transaction).
- `RideGateway` (chat/sockets) keys off ride participants, not creator — expected unaffected;
  confirm during P2.
