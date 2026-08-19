-- CreateEnum
CREATE TYPE "RideMode" AS ENUM ('INSTANT', 'SCHEDULED');

-- AlterTable
ALTER TABLE "rides" ADD COLUMN     "mode" "RideMode" NOT NULL DEFAULT 'SCHEDULED';
