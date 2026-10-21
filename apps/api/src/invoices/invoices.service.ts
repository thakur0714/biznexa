import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  amountInWords,
  invoiceLines,
  invoiceOrderLine,
  sameState,
  stateName,
  type InvoiceBuyer,
  type InvoiceLine,
  type InvoiceSeller,
  type InvoiceTaxType,
} from '@biznexa/types';
import { EventBus } from '../events/event-bus';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { Prisma } from '../generated/prisma/client';
import { InvoiceNumbersService } from './invoice-numbers.service';

/** Payment statuses that mean the money was received (a refund later doesn't undo the invoice; a credit note does). */
const RECEIVED = ['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;

/**
 * A payment the webhook applied to its order (M3.17): its `payment.captured` event has outcome `applied`.
 * Money kept apart for a refund (`order_not_pending`, `extra_capture`, `overpaid`) is SUCCESS too, but was
 * never owed, so it gets no invoice.
 */
const applied = { webhookEvents: { some: { event: 'payment.captured', outcome: 'applied' } } } satisfies Prisma.PaymentWhereInput;

export interface IssuedInvoice {
  id: string;
  number: string;
}

/**
 * Invoices (M3.21): one per successful payment — a full payment, an advance and its balance (M3.19) each
 * get one. Issued when `payment.succeeded` is emitted and, because events are not durable (D21), by a sweep
 * that finds applied payments still without one.
 *
 * Each invoice is made in **one transaction under the order's row lock** (the lock the webhook takes), so
 * the listener and the sweep can't both issue one, and the advance and balance invoices of an order are
 * worked out one after the other. The number comes from `InvoiceNumbersService.next` in that same
 * transaction (gap-free, D47). Seller, buyer and lines are copied onto the invoice when it is issued.
 */
@Injectable()
export class InvoicesService implements OnModuleInit {
  private readonly log = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbers: InvoiceNumbersService,
    private readonly settings: SettingsService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.events.on('payment.succeeded', (e) => this.issue(e.payload.paymentId));
  }

  /**
   * Issues the invoice for a payment, or returns the one it already has. Null when the payment is not one
   * the webhook applied to its order. Throws if the invoice can't be made; the sweep tries again.
   */
  async issue(paymentId: string, at: Date = new Date()): Promise<IssuedInvoice | null> {
    const result = await this.prisma.$transaction((tx) => this.create(tx, paymentId, at));
    if (!result) return null;
    if (result.created) {
      const { invoice } = result;
      await this.events.emit('invoice.issued', {
        invoiceId: invoice.id,
        number: invoice.number,
        paymentId,
        orderId: invoice.orderId,
        customerId: invoice.customerId,
        total: invoice.total,
      });
    }
    return { id: result.invoice.id, number: result.invoice.number };
  }

  /** Every 10 minutes: invoices for applied payments that have none (an event lost to a crash, or an earlier failure). */
  @Cron('*/10 * * * *')
  async issueMissing(): Promise<number> {
    const due = await this.prisma.payment.findMany({
      where: { status: { in: [...RECEIVED] }, orderId: { not: null }, invoice: null, ...applied },
      // Oldest first, so an advance is invoiced before its balance.
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      take: 100,
      select: { id: true },
    });
    let issued = 0;
    // One at a time, oldest first: invoice numbers are a gap-free sequence in issue order.
    for (const { id } of due) {
      try {
        if (await this.issue(id)) issued++; // NOSONAR
      } catch (e) {
        this.log.error(`Invoice for payment ${id} could not be issued: ${e instanceof Error ? e.message : e}`, e instanceof Error ? e.stack : undefined);
      }
    }
    if (issued) this.log.warn(`Issued ${issued} missing invoice(s)`);
    return issued;
  }

  private async create(tx: Prisma.TransactionClient, paymentId: string, at: Date) {
    const found = await tx.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } });
    if (!found?.orderId) return null;
    // The webhook's lock: invoices of one order are made one at a time, after the payment is applied.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.orderId} FOR UPDATE`;

    const existing = await tx.invoice.findUnique({ where: { paymentId }, select: invoiceSelect });
    if (existing) return { invoice: existing, created: false };
    const payment = await tx.payment.findFirst({ where: { id: paymentId, status: { in: [...RECEIVED] }, ...applied }, select: { amount: true } });
    if (!payment) {
      this.log.warn(`Payment ${paymentId} was not applied to its order; no invoice`);
      return null;
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: found.orderId },
      select: {
        id: true,
        customerId: true,
        buyerState: true,
        total: true,
        items: { orderBy: { id: 'asc' }, select: { id: true, description: true, sacCode: true, professionalFee: true, governmentFee: true, discount: true, gstRate: true } },
        invoices: { orderBy: { issuedAt: 'asc' }, select: { lines: true, taxType: true, placeOfSupply: true } },
        customer: { select: { name: true, email: true, mobile: true, customerProfile: { select: { address: true, city: true, state: true, pincode: true } } } },
        applications: {
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { businessEntity: { select: { legalName: true, gstin: true, address: true, state: true } } },
        },
      },
    });

    const s = await this.settings.seller(tx);
    const seller: InvoiceSeller = { name: s.name, legalName: s.legalName, gstin: s.gstin, email: s.email, phone: s.phone, address: s.address, state: s.state };
    if (!seller.gstin) this.log.error(`Invoice for payment ${paymentId} is issued without a seller GSTIN: set it in Settings`);

    // Place of supply as the order summary charged it: the buyer's state, else the seller's own (M3.13).
    // A later invoice of the same order (the balance) keeps the first one's split, even if Settings changed.
    const first = order.invoices[0];
    const placeOfSupply = first ? first.placeOfSupply : (stateName(order.buyerState) ?? seller.state);
    const intraState = !!seller.state && !!placeOfSupply && sameState(seller.state, placeOfSupply);
    let taxType: InvoiceTaxType = intraState ? 'CGST_SGST' : 'IGST';
    if (first) taxType = first.taxType as InvoiceTaxType;

    const lines = order.items.map((i) => invoiceOrderLine(i, taxType));
    const charged = lines.reduce((a, l) => a + l.taxableValue + l.cgst + l.sgst + l.igst + l.governmentFee, 0);
    if (charged !== order.total) throw new Error(`Order ${order.id} lines add up to ${charged} paise, but its total is ${order.total}`);
    const previous = order.invoices.flatMap((i) => i.lines as unknown as InvoiceLine[]);
    const amounts = invoiceLines(lines, previous, payment.amount, taxType);

    const buyer = buyerOf(order.customer, order.applications[0]?.businessEntity ?? null);
    const number = await this.numbers.next(tx, s.invoicePrefix, at);
    const invoice = await tx.invoice.create({
      data: {
        number: number.number,
        financialYear: number.financialYear,
        sequence: number.sequence,
        issuedAt: at,
        orderId: order.id,
        paymentId,
        customerId: order.customerId,
        sellerGstin: seller.gstin,
        seller: json(seller),
        buyerName: buyer.name,
        buyerGstin: buyer.gstin,
        buyer: json(buyer),
        placeOfSupply,
        taxType,
        lines: json(amounts.lines),
        taxableValue: amounts.taxableValue,
        cgst: amounts.cgst,
        sgst: amounts.sgst,
        igst: amounts.igst,
        govtFees: amounts.govtFees,
        discount: amounts.discount,
        total: amounts.total,
        amountInWords: amountInWords(amounts.total),
      },
      select: invoiceSelect,
    });
    return { invoice, created: true };
  }
}

const invoiceSelect = { id: true, number: true, orderId: true, customerId: true, total: true } satisfies Prisma.InvoiceSelect;

/** Drops `undefined` (an address without line2) so the stored JSON is exactly what is printed. */
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue; // NOSONAR: structuredClone would keep the `undefined`

type Address = NonNullable<InvoiceBuyer['address']>;

/** The business on the application when there is one (its GSTIN makes this a B2B invoice), else the customer. */
function buyerOf(
  customer: { name: string; email: string | null; mobile: string | null; customerProfile: { address: string | null; city: string | null; state: string | null; pincode: string | null } | null },
  business: { legalName: string; gstin: string | null; address: unknown; state: string | null } | null,
): InvoiceBuyer {
  const contact = { email: customer.email, mobile: customer.mobile };
  if (business) {
    const address = isAddress(business.address) ? business.address : null;
    return { name: business.legalName, gstin: business.gstin, ...contact, address, state: stateName(address?.state ?? business.state) };
  }
  const p = customer.customerProfile;
  const state = stateName(p?.state);
  const address = p?.address && p.city && state && p.pincode ? { line1: p.address, city: p.city, state, pincode: p.pincode } : null;
  return { name: customer.name, gstin: null, ...contact, address, state };
}

function isAddress(v: unknown): v is Address {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return typeof a.line1 === 'string' && typeof a.city === 'string' && typeof a.state === 'string' && typeof a.pincode === 'string';
}
