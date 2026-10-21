import { ConflictException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PERMS, type FileLinkResult, type InvoiceBuyer, type InvoiceLine, type InvoiceSeller, type InvoiceTaxType } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import { EventBus } from '../events/event-bus';
import { checkSignedLink, contentDisposition, signedLink, type Disposition } from '../files/files.service';
import { StorageService } from '../files/storage.service';
import { PdfService } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { invoiceHtml, type InvoicePrint } from './invoice-template';

export const CREDIT_NOTE_PDF = 'credit-note';

/**
 * Credit note PDFs (M4.13): the invoice page (`invoiceHtml`) printed as a credit note, queued on
 * `credit_note.issued`, its key kept on `CreditNote.pdfKey`. Downloaded like invoices (D50): a signed link for
 * the credit note itself, for the customer it was issued to or staff who can view payments.
 */
@Injectable()
export class CreditNotePdfService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfs: PdfService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    this.pdfs.register(CREDIT_NOTE_PDF, {
      existing: async (id) => (await this.prisma.creditNote.findUnique({ where: { id }, select: { pdfKey: true } }))?.pdfKey ?? null,
      source: async (id) => {
        const print = await this.print(id);
        return print && { html: invoiceHtml(print) };
      },
      attach: async (id, fileKey) => (await this.prisma.creditNote.updateMany({ where: { id, pdfKey: null }, data: { pdfKey: fileKey } })).count === 1,
      missing: async () => (await this.prisma.creditNote.findMany({ where: { pdfKey: null }, orderBy: { issuedAt: 'asc' }, select: { id: true } })).map((c) => c.id),
    });
    this.events.on('credit_note.issued', (e) => this.pdfs.enqueue(CREDIT_NOTE_PDF, e.payload.creditNoteId));
  }

  /** The credit note as printed, or null when it is gone. */
  async print(id: string): Promise<InvoicePrint | null> {
    const cn = await this.prisma.creditNote.findUnique({
      where: { id },
      include: {
        invoice: { select: { number: true, issuedAt: true, order: { select: { code: true } }, payment: { select: { gatewayPaymentId: true, method: true, paidAt: true } } } },
      },
    });
    if (!cn) return null;
    return {
      number: cn.number,
      issuedAt: cn.issuedAt,
      seller: cn.seller as unknown as InvoiceSeller,
      buyer: cn.buyer as unknown as InvoiceBuyer,
      placeOfSupply: cn.placeOfSupply,
      taxType: cn.taxType as InvoiceTaxType,
      lines: cn.lines as unknown as InvoiceLine[],
      taxableValue: cn.taxableValue,
      cgst: cn.cgst,
      sgst: cn.sgst,
      igst: cn.igst,
      govtFees: cn.govtFees,
      discount: cn.discount,
      total: cn.total,
      amountInWords: cn.amountInWords,
      orderCode: cn.invoice.order.code,
      payment: { reference: cn.invoice.payment.gatewayPaymentId, method: cn.invoice.payment.method, paidAt: cn.invoice.payment.paidAt },
      creditNote: { invoiceNumber: cn.invoice.number, invoiceDate: cn.invoice.issuedAt, reason: cn.reason },
    };
  }

  /** Owner or `payments.view`, else 404; 409 while the PDF is being made. */
  async createLink(id: string, user: AuthUser, disposition: Disposition, now = Date.now()): Promise<FileLinkResult> {
    const cn = await this.prisma.creditNote.findUnique({ where: { id }, select: { customerId: true, pdfKey: true } });
    if (!cn || (cn.customerId !== user.id && !user.permissions.includes(PERMS.PAYMENTS_VIEW))) throw new NotFoundException('Credit note not found');
    if (!cn.pdfKey) {
      this.pdfs.enqueue(CREDIT_NOTE_PDF, id);
      throw new ConflictException('Your credit note is still being prepared. Please try again in a minute.');
    }
    return signedLink('credit-notes', id, disposition, now);
  }

  async openLinked(id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()) {
    const disposition = checkSignedLink('credit-notes', id, q, now);
    const cn = await this.prisma.creditNote.findUnique({ where: { id }, select: { number: true, pdfKey: true } });
    if (!cn?.pdfKey) throw new NotFoundException('Credit note not found');
    const { stream, size } = await this.storage.read(cn.pdfKey);
    return { stream, size, disposition: contentDisposition(disposition, `Credit note ${cn.number.replaceAll('/', '-')}.pdf`) };
  }
}
