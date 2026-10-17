import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { amountInWords, creditNoteLines, type InvoiceLine, type InvoiceTaxType } from '@biznexa/types';
import { EventBus } from '../events/event-bus';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceNumbersService } from './invoice-numbers.service';

export interface IssuedCreditNote {
  id: string;
  number: string;
}

/**
 * Credit notes (M4.13, D53): one per PROCESSED refund of a payment that has an invoice — the reverse of that
 * invoice's lines (`creditNoteLines`; a share of them for a partial refund). Issued on `refund.processed` and,
 * because events are not durable (D21), by a sweep, like invoices (D48).
 *
 * Made in **one transaction under the order's row lock** (the lock invoices take), so the listener and the
 * sweep can't both issue one, and two credit notes of an invoice are worked out one after the other. The
 * number comes from `InvoiceNumbersService.nextCreditNote` in that transaction (gap-free). Seller, buyer,
 * place of supply and tax split are copied from the invoice, so the credit note matches it.
 * A refund of money that was never invoiced (an overpayment, D48) gets no credit note.
 */
@Injectable()
export class CreditNotesService implements OnModuleInit {
  private readonly log = new Logger(CreditNotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: InvoiceNumbersService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.events.on('refund.processed', (e) => this.issue(e.payload.refundId));
  }

  /** Issues the credit note for a refund, or returns the one it has. Null when the refund isn't PROCESSED or its payment has no invoice yet. */
  async issue(refundId: string, at: Date = new Date()): Promise<IssuedCreditNote | null> {
    const result = await this.prisma.$transaction((tx) => this.create(tx, refundId, at));
    if (!result) return null;
    if (result.created) {
      const { note } = result;
      await this.events.emit('credit_note.issued', { creditNoteId: note.id, number: note.number, refundId, customerId: note.customerId, total: note.total });
    }
    return { id: result.note.id, number: result.note.number };
  }

  /** Every 10 minutes: credit notes for processed refunds of invoiced payments that have none. */
  @Cron('*/10 * * * *')
  async issueMissing(): Promise<number> {
    const due = await this.prisma.refund.findMany({
      where: { status: 'PROCESSED', creditNote: null, payment: { invoice: { isNot: null } } },
      orderBy: [{ processedAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: { id: true },
    });
    let issued = 0;
    for (const { id } of due) {
      try {
        if (await this.issue(id)) issued++;
      } catch (e) {
        this.log.error(`Credit note for refund ${id} could not be issued: ${e instanceof Error ? e.message : e}`, e instanceof Error ? e.stack : undefined);
      }
    }
    if (issued) this.log.warn(`Issued ${issued} missing credit note(s)`);
    return issued;
  }

  private async create(tx: Prisma.TransactionClient, refundId: string, at: Date) {
    const found = await tx.refund.findUnique({ where: { id: refundId }, select: { payment: { select: { orderId: true } } } });
    if (!found) return null;
    if (found.payment.orderId) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.payment.orderId} FOR UPDATE`;

    const existing = await tx.creditNote.findUnique({ where: { refundId }, select: noteSelect });
    if (existing) return { note: existing, created: false };
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      select: {
        status: true,
        amount: true,
        reason: true,
        payment: {
          select: {
            invoice: {
              select: {
                id: true,
                customerId: true,
                seller: true,
                buyer: true,
                placeOfSupply: true,
                taxType: true,
                lines: true,
                creditNotes: { select: { lines: true } },
              },
            },
          },
        },
      },
    });
    const invoice = refund.payment.invoice;
    if (refund.status !== 'PROCESSED') return null;
    if (!invoice) {
      this.log.warn(`Refund ${refundId}: its payment has no invoice (yet); no credit note`);
      return null;
    }

    const taxType = invoice.taxType as InvoiceTaxType;
    const previous = invoice.creditNotes.flatMap((c) => c.lines as unknown as InvoiceLine[]);
    const amounts = creditNoteLines(invoice.lines as unknown as InvoiceLine[], previous, refund.amount, taxType);
    const number = await this.numbers.nextCreditNote(tx, at);
    const note = await tx.creditNote.create({
      data: {
        number: number.number,
        financialYear: number.financialYear,
        sequence: number.sequence,
        issuedAt: at,
        refundId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        seller: invoice.seller as Prisma.InputJsonValue,
        buyer: invoice.buyer as Prisma.InputJsonValue,
        placeOfSupply: invoice.placeOfSupply,
        taxType,
        lines: JSON.parse(JSON.stringify(amounts.lines)) as Prisma.InputJsonValue,
        taxableValue: amounts.taxableValue,
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        igst: amounts.igst,
        govtFees: amounts.govtFees,
        discount: amounts.discount,
        total: amounts.total,
        amountInWords: amountInWords(amounts.total),
        reason: refund.reason,
      },
      select: noteSelect,
    });
    await tx.refund.update({ where: { id: refundId }, data: { creditNoteNo: note.number } });
    return { note, created: true };
  }
}

const noteSelect = { id: true, number: true, customerId: true, total: true } satisfies Prisma.CreditNoteSelect;
