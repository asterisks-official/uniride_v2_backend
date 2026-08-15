-- CreateEnum
CREATE TYPE "BlockedIdentityType" AS ENUM ('EMAIL', 'STUDENT_ID', 'PHONE');

-- AlterTable
ALTER TABLE "rider_profiles" ADD COLUMN     "rejection_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "blocked_identities" (
    "id" TEXT NOT NULL,
    "type" "BlockedIdentityType" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "blocked_identities_type_value_key" ON "blocked_identities"("type", "value");
