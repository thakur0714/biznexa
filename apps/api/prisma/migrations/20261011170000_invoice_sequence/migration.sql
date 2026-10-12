-- Gap-free invoice numbers (M3.20, D47). Unlike the order/application code sequences, a Postgres sequence
-- would skip numbers on rollback, which GST invoices must not do. InvoiceNumbersService bumps this row
-- with INSERT … ON CONFLICT DO UPDATE in the invoice's own transaction: the row lock serialises concurrent
-- invoices of the same year, and a rollback undoes the bump.
CREATE TABLE "InvoiceSequence" (
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("financialYear")
);
