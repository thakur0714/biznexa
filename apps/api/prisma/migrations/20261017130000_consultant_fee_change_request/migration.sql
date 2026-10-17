CREATE TYPE "ConsultantFeeChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "ConsultantFeeChangeRequest" (
  "id" TEXT NOT NULL,
  "consultantId" TEXT NOT NULL,
  "requestedFee" INTEGER NOT NULL,
  "status" "ConsultantFeeChangeStatus" NOT NULL DEFAULT 'PENDING',
  "decisionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  CONSTRAINT "ConsultantFeeChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultantFeeChangeRequest_consultantId_status_createdAt_idx"
  ON "ConsultantFeeChangeRequest"("consultantId", "status", "createdAt");

ALTER TABLE "ConsultantFeeChangeRequest"
  ADD CONSTRAINT "ConsultantFeeChangeRequest_consultantId_fkey"
  FOREIGN KEY ("consultantId") REFERENCES "Consultant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConsultantFeeChangeRequest"
  ADD CONSTRAINT "ConsultantFeeChangeRequest_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
