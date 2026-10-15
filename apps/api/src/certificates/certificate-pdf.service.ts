import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PERMS, effectiveCertificateStatus, type FileLinkResult } from '@biznexa/types';
import type { AuthUser } from '../common/auth.decorators';
import { EventBus } from '../events/event-bus';
import { checkSignedLink, contentDisposition, signedLink, type Disposition } from '../files/files.service';
import { StorageService } from '../files/storage.service';
import { PdfService } from '../pdf/pdf.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CertificatesService } from './certificates.service';
import { certificateHtml, type CertificatePrint } from './certificate-template';

export const CERTIFICATE_PDF = 'certificate';

@Injectable()
export class CertificatePdfService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfs: PdfService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
    private readonly certs: CertificatesService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.pdfs.register(CERTIFICATE_PDF, {
      existing: async (id) => (await this.prisma.certificate.findUnique({ where: { id }, select: { pdfKey: true } }))?.pdfKey ?? null,
      source: async (id) => {
        const print = await this.print(id);
        return (
          print && {
            html: certificateHtml(print),
            options: {
              landscape: true,
              format: 'A4',
              margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
            },
          }
        );
      },
      attach: async (id, fileKey) => (await this.prisma.certificate.updateMany({ where: { id, pdfKey: null }, data: { pdfKey: fileKey } })).count === 1,
      missing: async () => (await this.prisma.certificate.findMany({ where: { pdfKey: null }, select: { id: true } })).map((c) => c.id),
    });

    this.events.on('certificate.issued', (e) => this.pdfs.enqueue(CERTIFICATE_PDF, e.payload.certificateId));
  }

  /** Printable certificate payload with embedded QR data URL */
  async print(id: string): Promise<CertificatePrint | null> {
    const cert = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        certificationBody: { select: { name: true, accreditation: true, website: true, logoUrl: true } },
      },
    });
    if (!cert) return null;

    const qrUrl = this.certs.qrUrl(cert.verificationId);
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: 240 });

    return {
      certificateNumber: cert.certificateNumber,
      verificationId: cert.verificationId,
      type: cert.type,
      organizationName: cert.organizationName,
      scope: cert.scope,
      address: cert.address,
      issueDate: cert.issueDate,
      validFrom: cert.validFrom,
      validUntil: cert.validUntil,
      status: cert.status,
      certificationBody: cert.certificationBody,
      qrUrl,
      qrDataUrl,
    };
  }

  /**
   * Generates a signed download link for staff or the customer who owns the certificate.
   * Throws 404 if not authorized or not found, 409 if PDF is still generating.
   */
  async createLink(id: string, user: AuthUser, disposition: Disposition, now = Date.now()): Promise<FileLinkResult> {
    const cert = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        businessEntity: { select: { ownerId: true } },
        application: { select: { customerId: true } },
      },
    });

    const isStaff = user.permissions.includes(PERMS.CERTIFICATES_MANAGE);
    const isOwner =
      cert?.businessEntity?.ownerId === user.id ||
      cert?.application?.customerId === user.id;

    if (!cert || (!isStaff && !isOwner)) {
      throw new NotFoundException('Certificate not found');
    }

    if (!cert.pdfKey) {
      this.pdfs.enqueue(CERTIFICATE_PDF, id);
      throw new ConflictException('Your certificate is still being prepared. Please try again in a minute.');
    }

    return signedLink('certificates', id, disposition, now);
  }

  /** Opens a certificate PDF from a valid signed link */
  async openLinked(id: string, q: { e?: string; d?: string; s?: string }, now = Date.now()) {
    const disposition = checkSignedLink('certificates', id, q, now);
    const cert = await this.prisma.certificate.findUnique({ where: { id }, select: { certificateNumber: true, pdfKey: true } });
    if (!cert?.pdfKey) throw new NotFoundException('Certificate not found');

    const { stream, size } = await this.storage.read(cert.pdfKey);
    return {
      stream,
      size,
      disposition: contentDisposition(disposition, `Certificate ${cert.certificateNumber.replace(/\//g, '-')}.pdf`),
    };
  }

  /** Public download when showPdfPublicly is true */
  async openPublic(idOrNumber: string, disposition: Disposition = 'attachment') {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
    const cert = await this.prisma.certificate.findFirst({
      where: isUuid
        ? { OR: [{ id: idOrNumber }, { certificateNumber: idOrNumber }, { verificationId: idOrNumber }] }
        : { OR: [{ certificateNumber: { equals: idOrNumber, mode: 'insensitive' } }, { verificationId: idOrNumber.toUpperCase() }] },
      select: { id: true, certificateNumber: true, pdfKey: true, showPdfPublicly: true, status: true, validUntil: true },
    });

    if (!cert) throw new NotFoundException('Certificate not found');
    // A suspended, withdrawn or expired certificate's PDF still reads "valid" — never hand it out publicly.
    if (!cert.showPdfPublicly || effectiveCertificateStatus(cert.status, cert.validUntil) !== 'ACTIVE') {
      throw new ForbiddenException('Public PDF download is not enabled for this certificate');
    }
    if (!cert.pdfKey) {
      this.pdfs.enqueue(CERTIFICATE_PDF, cert.id);
      throw new ConflictException('Certificate PDF is still being prepared. Please try again shortly.');
    }

    const { stream, size } = await this.storage.read(cert.pdfKey);
    return {
      stream,
      size,
      disposition: contentDisposition(disposition, `Certificate ${cert.certificateNumber.replace(/\//g, '-')}.pdf`),
    };
  }

  /** Attach a user-uploaded PDF (uploaded via M2.5.6 upload service) to a certificate */
  async attachUploadedPdf(id: string, fileId: string, actorId: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');

    const stored = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!stored) throw new BadRequestException('Uploaded file not found');
    if (stored.mimeType !== 'application/pdf' && !stored.originalName.toLowerCase().endsWith('.pdf')) {
      throw new BadRequestException('The attached file must be a PDF');
    }
    if (stored.scanStatus === 'INFECTED') {
      throw new GoneException('This file was blocked because a virus was found in it. Please upload a clean copy.');
    }
    if (stored.scanStatus === 'PENDING') {
      throw new ConflictException('This file is still being checked for viruses. Please try again in a minute.');
    }

    const updated = await this.prisma.certificate.update({
      where: { id },
      data: { pdfKey: stored.fileKey },
    });

    await this.audit.log({
      actorId,
      action: 'certificate.pdf_upload',
      entityType: 'Certificate',
      entityId: id,
      before: { pdfKey: cert.pdfKey },
      after: { pdfKey: updated.pdfKey, fileId: stored.id },
    });

    return updated;
  }

  /** Per-certificate toggle for public PDF download */
  async togglePublicDownload(id: string, showPdfPublicly: boolean, actorId: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');

    const updated = await this.prisma.certificate.update({
      where: { id },
      data: { showPdfPublicly },
    });

    await this.audit.log({
      actorId,
      action: 'certificate.public_download_toggle',
      entityType: 'Certificate',
      entityId: id,
      before: { showPdfPublicly: cert.showPdfPublicly },
      after: { showPdfPublicly: updated.showPdfPublicly },
    });

    return updated;
  }

  /** Regenerate PDF using the official template */
  async regenerate(id: string, actorId: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');

    await this.prisma.certificate.update({
      where: { id },
      data: { pdfKey: null },
    });

    this.pdfs.enqueue(CERTIFICATE_PDF, id);

    await this.audit.log({
      actorId,
      action: 'certificate.pdf_regenerate',
      entityType: 'Certificate',
      entityId: id,
    });

    return { message: 'Certificate PDF regeneration queued' };
  }
}
