-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "ActiveMode" AS ENUM ('PASSENGER', 'RIDER');

-- AlterTable
ALTER TABLE "rider_profiles" ADD COLUMN     "license_plate_photo_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_mode" "ActiveMode" NOT NULL DEFAULT 'PASSENGER',
ADD COLUMN     "gender" "Gender";
