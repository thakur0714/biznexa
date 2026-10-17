-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "holdExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Booking_customerId_startAt_idx" ON "Booking"("customerId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_status_holdExpiresAt_idx" ON "Booking"("status", "holdExpiresAt");

-- M8.8 (D58): no two live bookings (PENDING_PAYMENT hold or CONFIRMED) of one consultant may overlap.
-- Enforced by the database, not only by the service's consultant row lock. An expired hold is set to EXPIRED
-- before its slot is booked again, so the constraint only ever sees live holds.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist ("consultantId" WITH =, tsrange("startAt", "endAt") WITH &&)
  WHERE ("status" IN ('PENDING_PAYMENT', 'CONFIRMED'));
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_times_check" CHECK ("endAt" > "startAt");

-- Booking codes: BKG-<IST year>-<6 digits>, like order codes (D35).
CREATE SEQUENCE IF NOT EXISTS booking_code_seq START 1;
