import { Injectable } from '@nestjs/common';
import { DEFAULT_INVOICE_PREFIX, financialYear, formatInvoiceNumber } from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';

export interface InvoiceNumber {
  /** `BN/2627/000123` */
  number: string;
  /** `2026-27` */
  financialYear: string;
  sequence: number;
}

/**
 * Gap-free invoice numbers per financial year (M3.20, D47).
 *
 * `next` must run in the transaction that creates the `Invoice`: the upsert below locks that year's
 * `InvoiceSequence` row until the transaction ends, so concurrent invoices queue up and get consecutive
 * numbers, and a rollback (including a failed invoice insert) hands the number back. Calling it outside
 * that transaction would burn a number with nothing to show for it — a gap.
 */
@Injectable()
export class InvoiceNumbersService {
  /**
   * @param prefix the seller's `invoicePrefix` (M3.14); `BN` when not set.
   * @param at the invoice date; decides the financial year (IST).
   */
  async next(tx: Prisma.TransactionClient, prefix: string | null, at: Date = new Date()): Promise<InvoiceNumber> {
    const fy = financialYear(at);
    const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "InvoiceSequence" ("financialYear", "lastNumber", "updatedAt") VALUES (${fy}, 1, now())
      ON CONFLICT ("financialYear") DO UPDATE SET "lastNumber" = "InvoiceSequence"."lastNumber" + 1, "updatedAt" = now()
      RETURNING "lastNumber"`;
    const sequence = Number(row.lastNumber);
    return { number: formatInvoiceNumber(prefix ?? DEFAULT_INVOICE_PREFIX, fy, sequence), financialYear: fy, sequence };
  }
}
