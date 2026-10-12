import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PERMS, type FileLinkResult, type InvoiceBuyer, type InvoiceLine, type InvoiceSeller, type InvoiceSummary, type InvoiceTaxType } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import { EventBus } from '../events/event-bus';
import { checkSignedLink, contentDisposition, signedLink, type Disposition } from '../files/files.service';
import { StorageService } from '../files/storage.service';
import { PdfService } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { invoiceHtml } from './invoice-template';

export const INVOICE_PDF = 'invoice';

/**
 * Invoice PDFs (M3.23): the `invoice` kind of `PdfService` (M3.22) — queued on `invoice.issued`, printed from
 * the invoice row as issued (`invoiceHtml`), its key kept on `Invoice.pdfKey`; invoices still without one are
 * queued again at start-up. Downloads go through a signed link (D17) for the invoice itself, not a
 * `StoredFile`: the customer it was issued to, or staff who can view payments.
 */
@Injectable()
export class InvoicePdfService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfs: PdfService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.pdfs.register(INVOICE_PDF, {
      existing: async (id) => (await this.prisma.invoice.findUnique({ where: { id }, select: { pdfKey: true } }))?.pdfKey ?? null,
      source: async (id) => {
        const print = await this.print(id);
        return print && { html: invoiceHtml(print) };
      },
      attach: async (id, fileKey) => (await this.prisma.invoice.updateMany({ where: { id, pdfKey: null }, data: { pdfKey: fileKey } })).count === 1,
      missing: async () => (await this.prisma.invoice.findMany({ where: { pdfKey: null }, orderBy: { issuedAt: 'asc' }, select: { id: true } })).map((i) => i.id),
    });
    this.events.on('invoice.issued', (e) => this.pdfs.enqueue(INVOICE_PDF, e.payload.invoiceId));
  }

  /** The invoice row as printed, or null when it is gone. */
  async print(id: string) {
    const inv = await this.prisma.invoice.findUnique({
      where: { id },
      include: { order: { select: { code: true } }, payment: { select: { gatewayPaymentId: true, method: true, paidAt: true } } },
    });
    if (!inv) return null;
    return {
      number: inv.number,
      issuedAt: inv.issuedAt,
      seller: inv.seller as unknown as InvoiceSeller,
      buyer: inv.buyer as unknown as InvoiceBuyer,
      placeOfSupply: inv.placeOfSupply,
      taxType: inv.taxType as InvoiceTaxType,
      lines: inv.lines as unknown as InvoiceLine[],
      taxableValue: inv.taxableValue,
      cgst: inv.cgst,
      sgst: inv.sgst,
      igst: inv.igst,
      govtFees: inv.govtFees,
      discount: inv.discount,
      total: inv.total,
      amountInWords: inv.amountInWords,
      orderCode: inv.order.code,
      payment: { reference: inv.payment.gatewayPaymentId, method: inv.payment.method, paidAt: inv.payment.paidAt },
    };
  }

  /** The customer's own invoices, newest first; optionally only those of one application's order. */
  async list(customerId: string, applicationId?: string): Promise<InvoiceSummary[]> {
    const rows = await this.prisma.invoice.findMany({
      where: { customerId, ...(applicationId && { order: { applications: { some: { id: applicationId } } } }) },
      orderBy: [{ issuedAt: 'desc' }, { sequence: 'desc' }],
      select: { id: true, number: true, issuedAt: true, total: true, pdfKey: true, order: { select: { code: true } } },
    });
    return rows.map((r) => ({ id: r.id, number: r.number, issuedAt: r.issuedAt.toISOString(), orderCode: r.order.code, total: r.total, pdfReady: !!r.pdfKey }));
  }

  /** Owner or `payments.view`, else 404 (no access looks like no invoice); 409 while the PDF is being made. */
  async createLink(id: string, user: AuthUser, disposition: Disposition, now = Date.now()): Promise<FileLinkResult> {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { customerId: true, pdfKey: true } });
    if (!inv || (inv.customerId !== user.id && !user.permissions.includes(PERMS.PAYMENTS_VIEW))) throw new NotFoundException('Invoice not found');
    if (!inv.pdfKey) {
      // Queued again in case its job was lost; one job per invoice at a time, so this is cheap.
      this.pdfs.enqueue(INVOICE_PDF, id);
      throw new ConflictException('Your invoice is still being prepared. Please try again in a minute.');
    }
    return signedLink('invoices', id, disposition, now);
  }

  /** Checks a signed link and opens the PDF. */
  async openLinked(id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()) {
    const disposition = checkSignedLink('invoices', id, q, now);
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { number: true, pdfKey: true } });
    if (!inv?.pdfKey) throw new NotFoundException('Invoice not found');
    const { stream, size } = await this.storage.read(inv.pdfKey);
    return { stream, size, disposition: contentDisposition(disposition, `Invoice ${inv.number.replace(/\//g, '-')}.pdf`) };
  }
}
