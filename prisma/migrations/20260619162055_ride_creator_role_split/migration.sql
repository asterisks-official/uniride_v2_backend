-- Ride ownership normalization: introduce creator_id, make rider_id nullable.
-- creator_id = who posted the ride; rider_id = the actual driver (filled at match for REQUESTs).

-- DropForeignKey
ALTER TABLE "rides" DROP CONSTRAINT "rides_rider_id_fkey";

-- AlterTable: add creator_id as NULLABLE first so we can backfill existing rows.
ALTER TABLE "rides" ADD COLUMN "creator_id" TEXT,
ALTER COLUMN "rider_id" DROP NOT NULL;

-- Backfill: the old rider_id always held the creator.
UPDATE "rides" SET "creator_id" = "rider_id";

-- Fix inverted ownership for passenger-created REQUEST posts that were stored with the
-- passenger in rider_id. Move them to passenger_id and clear rider_id (driver fills at match).
UPDATE "rides"
SET "passenger_id" = "rider_id", "rider_id" = NULL
WHERE "type" = 'REQUEST' AND "passenger_id" IS NULL;

-- Now that every row has a creator, enforce NOT NULL.
ALTER TABLE "rides" ALTER COLUMN "creator_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "rides_creator_id_idx" ON "rides"("creator_id");

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
