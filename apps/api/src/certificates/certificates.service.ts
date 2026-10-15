import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import { assertTransition, createCertificationBodyInput, effectiveCertificateStatus, updateCertificationBodyInput } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { env } from '../config/env';
import type { CertificateStatus } from '../generated/prisma/enums';

// No 0/O/1/I so IDs read cleanly off paper certificates.
const ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newVerificationId(length = 12): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export function qrSignature(verificationId: string): string {
  return createHmac('sha256', env().CERT_QR_SECRET).update(verificationId).digest('hex').slice(0, 16);
}

export const createCertificateInput = z
  .object({
    certificateNumber: z.string().trim().min(3).max(64).optional(),
    type: z.string().trim().min(2).max(120),
    organizationName: z.string().trim().min(2).max(200),
    scope: z.string().max(1000).optional(),
    address: z.string().max(500).optional(),
    issueDate: z.coerce.date(),
    validFrom: z.coerce.date(),
    validUntil: z.coerce.date(),
    certificationBodyId: z.string().uuid(),
    showPdfPublicly: z.boolean().default(false),
    applicationId: z.string().uuid().optional(),
    businessEntityId: z.string().uuid().optional(),
    fileId: z.string().uuid().optional(),
  })
  .refine((v) => v.validUntil > v.validFrom, { message: 'Valid until must be after valid from', path: ['validUntil'] });

export const statusInput = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED']),
  reason: z.string().trim().min(3).max(300),
});

export interface LookupMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger('Certificates');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  qrUrl(verificationId: string) {
    return `${env().PUBLIC_WEB_URL}/verify/${verificationId}?t=${qrSignature(verificationId)}`;
  }

  private isAuthenticQr(verificationId: string, t?: string) {
    if (!t) return null;
    const a = Buffer.from(qrSignature(verificationId));
    const b = Buffer.from(t);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Public verification. Never returns customer personal data. Every lookup is logged. */
  async verify(params: { number?: string; id?: string; t?: string }, meta: LookupMeta) {
    const number = params.number?.trim();
    const id = params.id?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const method = id ? (params.t ? 'QR' : 'VERIFICATION_ID') : 'NUMBER';

    const cert = await this.prisma.certificate.findFirst({
      where: id ? { verificationId: id } : { certificateNumber: { equals: number, mode: 'insensitive' } },
      include: { certificationBody: true },
    });

    await this.prisma.certificateLookup.create({
      data: {
        certificateId: cert?.id,
        query: (id ?? number ?? '').slice(0, 64),
        method,
        found: !!cert,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });

    const verifiedAt = new Date().toISOString();
    if (!cert) return { found: false as const, verifiedAt };

    const status = effectiveCertificateStatus(cert.status, cert.validUntil);
    return {
      found: true as const,
      verifiedAt,
      qrAuthentic: this.isAuthenticQr(cert.verificationId, params.t),
      certificate: {
        certificateNumber: cert.certificateNumber,
        verificationId: cert.verificationId,
        type: cert.type,
        organizationName: cert.organizationName,
        scope: cert.scope,
        issueDate: cert.issueDate,
        validFrom: cert.validFrom,
        validUntil: cert.validUntil,
        status,
        statusNote:
          status === 'SUSPENDED'
            ? 'This certificate is temporarily suspended by the certification body.'
            : status === 'WITHDRAWN'
              ? 'This certificate has been withdrawn and is no longer valid.'
              : status === 'EXPIRED'
                ? 'This certificate has passed its validity date.'
                : null,
        certificationBody: {
          name: cert.certificationBody.name,
          accreditation: cert.certificationBody.accreditation,
          website: cert.certificationBody.website,
        },
        pdfAvailable: cert.showPdfPublicly && !!cert.pdfKey,
      },
    };
  }

  async searchByOrganization(org: string, meta: LookupMeta) {
    const q = org.trim();
    if (q.length < 3) throw new BadRequestException('Enter at least 3 characters of the organisation name');
    const setting = await this.prisma.setting.findUnique({ where: { key: 'certificates.organizationSearch' } });
    if (setting && setting.value === false) throw new BadRequestException('Search by organisation is turned off');

    const rows = await this.prisma.certificate.findMany({
      where: { organizationName: { contains: q, mode: 'insensitive' } },
      orderBy: { validUntil: 'desc' },
      take: 10,
      include: { certificationBody: { select: { name: true } } },
    });
    await this.prisma.certificateLookup.create({
      data: { query: q.slice(0, 64), method: 'ORGANIZATION', found: rows.length > 0, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 255) },
    });
    return rows.map((c) => ({
      certificateNumber: c.certificateNumber,
      verificationId: c.verificationId,
      organizationName: c.organizationName,
      type: c.type,
      validUntil: c.validUntil,
      status: effectiveCertificateStatus(c.status, c.validUntil),
      certificationBody: c.certificationBody.name,
    }));
  }

  // ─────────────── Admin ───────────────

  async list(params: { q?: string; status?: CertificateStatus; page: number; limit: number }) {
    const where = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.q
        ? {
            OR: [
              { certificateNumber: { contains: params.q, mode: 'insensitive' as const } },
              { organizationName: { contains: params.q, mode: 'insensitive' as const } },
              { verificationId: { contains: params.q.toUpperCase() } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.certificate.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        include: { certificationBody: { select: { name: true } }, _count: { select: { lookups: true } } },
      }),
      this.prisma.certificate.count({ where }),
    ]);
    return { items, total, page: params.page, limit: params.limit };
  }

  private async nextCertificateNumber() {
    const year = new Date().getFullYear();
    const count = await this.prisma.certificate.count({ where: { certificateNumber: { startsWith: `BNC-${year}-` } } });
    return `BNC-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  async create(input: z.infer<typeof createCertificateInput>, actorId: string) {
    let pdfKey: string | null = null;
    if (input.fileId) {
      const stored = await this.prisma.storedFile.findUnique({ where: { id: input.fileId } });
      if (!stored) throw new BadRequestException('Uploaded file not found');
      if (stored.mimeType !== 'application/pdf' && !stored.originalName.toLowerCase().endsWith('.pdf')) {
        throw new BadRequestException('The attached file must be a PDF');
      }
      if (stored.scanStatus === 'INFECTED') {
        throw new BadRequestException('This file was blocked because a virus was found in it. Please upload a clean copy.');
      }
      if (stored.scanStatus === 'PENDING') {
        throw new ConflictException('This file is still being checked for viruses. Please try again in a minute.');
      }
      pdfKey = stored.fileKey;
    }

    const { fileId, ...rest } = input;
    const cert = await this.prisma.certificate.create({
      data: {
        ...rest,
        certificateNumber: input.certificateNumber ?? (await this.nextCertificateNumber()),
        verificationId: newVerificationId(),
        status: input.validUntil.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE',
        pdfKey,
      },
    });
    await this.audit.log({ actorId, action: 'certificate.issue', entityType: 'Certificate', entityId: cert.id, after: cert });
    await this.events.emit('certificate.issued', { certificateId: cert.id, certificateNumber: cert.certificateNumber, status: cert.status, actorId });
    return { ...cert, qrUrl: this.qrUrl(cert.verificationId) };
  }

  async changeStatus(id: string, input: z.infer<typeof statusInput>, actorId: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');
    try {
      assertTransition('certificate', cert.status, input.status);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (input.status === 'ACTIVE' && cert.validUntil.getTime() < Date.now()) {
      throw new BadRequestException('An expired certificate cannot be reactivated. Issue a renewal instead.');
    }
    const updated = await this.prisma.certificate.update({ where: { id }, data: { status: input.status, statusReason: input.reason } });
    await this.audit.log({ actorId, action: 'certificate.status', entityType: 'Certificate', entityId: id, before: { status: cert.status }, after: { status: updated.status, reason: input.reason } });
    await this.events.emit('certificate.status_changed', {
      certificateId: id,
      certificateNumber: cert.certificateNumber,
      from: cert.status,
      to: updated.status,
      actorId,
      reason: input.reason,
    });
    return updated;
  }

  async qr(id: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new NotFoundException('Certificate not found');
    const url = this.qrUrl(cert.verificationId);
    const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 360 });
    return { url, dataUrl };
  }

  lookups(id: string) {
    return this.prisma.certificateLookup.findMany({ where: { certificateId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async get(id: string) {
    const cert = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        certificationBody: { select: { id: true, name: true, accreditation: true, website: true } },
        _count: { select: { lookups: true } },
      },
    });
    if (!cert) throw new NotFoundException('Certificate not found');
    return {
      ...cert,
      status: effectiveCertificateStatus(cert.status, cert.validUntil),
      qrUrl: this.qrUrl(cert.verificationId),
    };
  }

  bodies() {
    return this.prisma.certificationBody.findMany({ orderBy: { name: 'asc' } });
  }

  async createBody(input: z.infer<typeof createCertificationBodyInput>, actorId: string) {
    const existing = await this.prisma.certificationBody.findUnique({ where: { name: input.name } });
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        message: 'A certification body with this name already exists',
        errors: [{ field: 'name', message: 'A certification body with this name already exists' }],
      });
    }
    const body = await this.prisma.certificationBody.create({ data: input });
    await this.audit.log({ actorId, action: 'certification_body.create', entityType: 'CertificationBody', entityId: body.id, after: body });
    return body;
  }

  async updateBody(id: string, input: z.infer<typeof updateCertificationBodyInput>, actorId: string) {
    const existing = await this.prisma.certificationBody.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Certification body not found');

    if (input.name && input.name !== existing.name) {
      const dup = await this.prisma.certificationBody.findUnique({ where: { name: input.name } });
      if (dup) {
        throw new ConflictException({
          statusCode: 409,
          message: 'A certification body with this name already exists',
          errors: [{ field: 'name', message: 'A certification body with this name already exists' }],
        });
      }
    }

    const updated = await this.prisma.certificationBody.update({ where: { id }, data: input });
    await this.audit.log({ actorId, action: 'certification_body.update', entityType: 'CertificationBody', entityId: id, before: existing, after: updated });
    return updated;
  }

  async deleteBody(id: string, actorId: string) {
    const existing = await this.prisma.certificationBody.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Certification body not found');

    const count = await this.prisma.certificate.count({ where: { certificationBodyId: id } });
    if (count > 0) {
      throw new ConflictException('Cannot delete certification body in use by certificates');
    }

    await this.prisma.certificationBody.delete({ where: { id } });
    await this.audit.log({ actorId, action: 'certification_body.delete', entityType: 'CertificationBody', entityId: id, before: existing });
    return { message: 'Certification body deleted' };
  }

  /** Nightly: mark certificates past their validity as EXPIRED. */
  @Cron('5 0 * * *', { timeZone: 'Asia/Kolkata' })
  async expireCertificates() {
    const reason = 'Validity period ended';
    const due = await this.prisma.certificate.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] }, validUntil: { lt: new Date() } },
      select: { id: true, certificateNumber: true, status: true },
    });
    let count = 0;
    for (const cert of due) {
      // Guarded on the old status so a concurrent admin change is not overwritten or announced twice.
      const res = await this.prisma.certificate.updateMany({ where: { id: cert.id, status: cert.status }, data: { status: 'EXPIRED', statusReason: reason } });
      if (!res.count) continue;
      count++;
      await this.events.emit('certificate.status_changed', {
        certificateId: cert.id,
        certificateNumber: cert.certificateNumber,
        from: cert.status,
        to: 'EXPIRED',
        actorId: null,
        reason,
      });
    }
    if (count) this.logger.log(`Marked ${count} certificate(s) as expired`);
    return count;
  }
}
