-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "passenger_end_lat" DOUBLE PRECISION,
ADD COLUMN     "passenger_end_lng" DOUBLE PRECISION,
ADD COLUMN     "passenger_start_lat" DOUBLE PRECISION,
ADD COLUMN     "passenger_start_lng" DOUBLE PRECISION,
ADD COLUMN     "rider_end_lat" DOUBLE PRECISION,
ADD COLUMN     "rider_end_lng" DOUBLE PRECISION,
ADD COLUMN     "rider_start_lat" DOUBLE PRECISION,
ADD COLUMN     "rider_start_lng" DOUBLE PRECISION;
