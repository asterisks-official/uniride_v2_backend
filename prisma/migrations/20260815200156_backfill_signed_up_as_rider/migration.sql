-- Data-only migration.
--
-- `signed_up_as_rider` was added after these accounts existed, so it defaulted
-- to false for everyone — including people who had already applied to be a
-- rider. That left every pre-existing applicant ungated: the client asks the
-- server "did this account sign up as a rider?", got false, and let them into
-- the app with an application still under review.
--
-- Having a rider profile at all *is* the evidence that they applied, so it is
-- the safe thing to backfill from. Accounts with no rider profile are left
-- alone: they never applied and must not be locked out.
UPDATE "users" u
   SET "signed_up_as_rider" = true
  FROM "rider_profiles" rp
 WHERE rp."user_id" = u."id"
   AND u."signed_up_as_rider" = false;
