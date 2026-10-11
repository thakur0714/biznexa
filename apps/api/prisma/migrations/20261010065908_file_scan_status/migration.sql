-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED');

-- AlterTable
ALTER TABLE "StoredFile" ADD COLUMN     "scanSignature" TEXT,
ADD COLUMN     "scanStatus" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "scannedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StoredFile_scanStatus_idx" ON "StoredFile"("scanStatus");
