-- CreateTable
CREATE TABLE "driver_availability" (
    "user_id" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "last_seen_at" TIMESTAMP(3),
    "active_ride_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_availability_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "driver_availability_is_online_lat_lng_idx" ON "driver_availability"("is_online", "lat", "lng");

-- AddForeignKey
ALTER TABLE "driver_availability" ADD CONSTRAINT "driver_availability_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
