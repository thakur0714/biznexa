-- M3.21: an invoice per successful payment, with everything it prints copied onto it when issued (seller and
-- buyer details, lines with SAC/GST and government fees, amount in words), so later changes to Settings, the
-- business or prices never alter it. No invoices exist before this step, so the NOT NULL columns need no default.
-- The seller GSTIN may be empty in Settings (seed), so it is now optional.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "amountInWords" TEXT NOT NULL,
ADD COLUMN     "buyer" JSONB NOT NULL,
ADD COLUMN     "customerId" TEXT NOT NULL,
ADD COLUMN     "issuedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "lines" JSONB NOT NULL,
ADD COLUMN     "seller" JSONB NOT NULL,
ADD COLUMN     "taxType" TEXT NOT NULL,
ALTER COLUMN "sellerGstin" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Invoice_orderId_idx" ON "Invoice"("orderId");

-- CreateIndex
CREATE INDEX "Invoice_customerId_issuedAt_idx" ON "Invoice"("customerId", "issuedAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
