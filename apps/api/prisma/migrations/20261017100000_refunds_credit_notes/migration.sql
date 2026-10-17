-- M4.13 Refunds: idempotency key, failure reason and processed time on Refund; credit notes with their own counter.
-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "refundId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "placeOfSupply" TEXT,
    "taxType" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "taxableValue" INTEGER NOT NULL,
    "cgst" INTEGER NOT NULL DEFAULT 0,
    "sgst" INTEGER NOT NULL DEFAULT 0,
    "igst" INTEGER NOT NULL DEFAULT 0,
    "govtFees" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "amountInWords" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteSequence" (
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditNoteSequence_pkey" PRIMARY KEY ("financialYear")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_refundId_key" ON "CreditNote"("refundId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_customerId_issuedAt_idx" ON "CreditNote"("customerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_financialYear_sequence_key" ON "CreditNote"("financialYear", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_gatewayRefundId_key" ON "Refund"("gatewayRefundId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Refund_paymentId_idx" ON "Refund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_paymentId_idempotencyKey_key" ON "Refund"("paymentId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "Refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

