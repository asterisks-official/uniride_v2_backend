-- CreateEnum
CREATE TYPE "RideDirection" AS ENUM ('TO_CAMPUS', 'FROM_CAMPUS');

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "campus_id" TEXT,
ADD COLUMN     "direction" "RideDirection",
ADD COLUMN     "university_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "university_id" TEXT;

-- CreateTable
CREATE TABLE "universities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "verify_domains" TEXT[],
    "requires_id_card" BOOLEAN NOT NULL DEFAULT false,
    "fare_base" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fare_per_km" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "fare_per_min" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "universities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campuses" (
    "id" TEXT NOT NULL,
    "university_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_places" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "area_label" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ride_stops" (
    "id" TEXT NOT NULL,
    "ride_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "area_label" TEXT NOT NULL,

    CONSTRAINT "ride_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "universities_short_name_key" ON "universities"("short_name");

-- CreateIndex
CREATE INDEX "campuses_university_id_idx" ON "campuses"("university_id");

-- CreateIndex
CREATE INDEX "saved_places_user_id_idx" ON "saved_places"("user_id");

-- CreateIndex
CREATE INDEX "ride_stops_lat_lng_idx" ON "ride_stops"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "ride_stops_ride_id_sequence_key" ON "ride_stops"("ride_id", "sequence");

-- CreateIndex
CREATE INDEX "rides_university_id_direction_status_scheduled_at_idx" ON "rides"("university_id", "direction", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "users_university_id_idx" ON "users"("university_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rides" ADD CONSTRAINT "rides_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_university_id_fkey" FOREIGN KEY ("university_id") REFERENCES "universities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ride_stops" ADD CONSTRAINT "ride_stops_ride_id_fkey" FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
