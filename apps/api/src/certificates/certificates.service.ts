import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as QRCode from 'qrcode';
import { z } from 'zod';
import {
  assertTransition,
  createCertificateFromApplicationInputSchema,
  createCertificateInputSchema,
  createCertificationBodyInput,
  effectiveCertificateStatus,
  updateCertificationBodyInput,
  type CertificateImportPreviewResponse,
  type CertificateImportPreviewRow,
  type CertificateImportResponse,
  type CertificateImportRowError,
} from '@biznexa/types';
import { mapHeaders, parseCsv, parseCsvBoolean, parseCsvDate } from './certificate-csv';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import type { Prisma as PrismaType } from '../generated/prisma/client';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import { env } from '../config/env';
import { AuthUser, PERMS } from '../common/auth.decorators';
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

export const createCertificateInput = createCertificateInputSchema;
export const createCertificateFromApplicationInput = createCertificateFromApplicationInputSchema;

export const statusInput = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED']),
  reason: z.string().trim().min(3).max(300),
});

export interface LookupMeta {
  ip?: string;
  userAgent?: string;
  apiKey?: string;
  isPartnerApi?: boolean;
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
    const defaultMethod = id ? (params.t ? 'QR' : 'VERIFICATION_ID') : 'NUMBER';
    const method = meta.isPartnerApi ? 'API' : defaultMethod;

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

  private async getNextCertificateNumber(tx: PrismaType.TransactionClient) {
    const year = new Date().getFullYear();
    const [row] = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "CertificateSequence" ("year", "lastNumber", "updatedAt") VALUES (${year}, 1, now())
      ON CONFLICT ("year") DO UPDATE SET "lastNumber" = "CertificateSequence"."lastNumber" + 1, "updatedAt" = now()
      RETURNING "lastNumber"`;
    return `BNC-${year}-${String(Number(row.lastNumber)).padStart(6, '0')}`;
  }

  private async syncManualCertificateNumber(tx: PrismaType.TransactionClient, certificateNumber: string) {
    const match = /^BNC-(\d{4})-(\d{6,})$/.exec(certificateNumber);
    if (!match) return;
    const year = Number(match[1]);
    const lastNumber = Number(match[2]);
    await tx.$executeRaw`
      INSERT INTO "CertificateSequence" ("year", "lastNumber", "updatedAt") VALUES (${year}, ${lastNumber}, now())
      ON CONFLICT ("year") DO UPDATE SET "lastNumber" = GREATEST("CertificateSequence"."lastNumber", EXCLUDED."lastNumber"), "updatedAt" = now()`;
  }

  private isCertificateNumberConflict(error: unknown) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return target === 'certificateNumber' || (Array.isArray(target) && target.includes('certificateNumber')) ||
      (typeof target === 'string' && target.includes('certificateNumber'));
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

    let organizationName = input.organizationName?.trim();
    let businessEntityId = input.businessEntityId || input.entityId;

    if (input.applicationId) {
      const app = await this.prisma.application.findUnique({
        where: { id: input.applicationId },
        include: { businessEntity: true },
      });
      if (!app) throw new NotFoundException('Application not found');
      if (!organizationName) {
        if (app.businessEntity?.legalName) {
          organizationName = app.businessEntity.legalName;
        } else {
          const cust = await this.prisma.user.findUnique({ where: { id: app.customerId } });
          organizationName = cust?.name || '';
        }
      }
      if (!businessEntityId && app.businessEntityId) {
        businessEntityId = app.businessEntityId;
      }
    }

    if (!organizationName) {
      throw new BadRequestException('Organisation name is required');
    }

    const { fileId, entityId, businessEntityId: _bId, organizationName: _org, ...rest } = input;

    const cert = await this.prisma.$transaction(async (tx) => {
      const certificateNumber = input.certificateNumber ?? (await this.getNextCertificateNumber(tx));
      if (input.certificateNumber) await this.syncManualCertificateNumber(tx, certificateNumber);
      const created = await tx.certificate.create({
        data: {
          ...rest,
          organizationName,
          businessEntityId,
          applicationId: input.applicationId,
          certificateNumber,
          verificationId: newVerificationId(),
          status: input.validUntil.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE',
          pdfKey,
        },
        include: {
          certificationBody: { select: { id: true, name: true, accreditation: true, website: true } },
          _count: { select: { lookups: true } },
        },
      });
      await this.audit.log({ actorId, action: 'certificate.issue', entityType: 'Certificate', entityId: created.id, after: created }, tx);
      return created;
    }, { maxWait: 60_000, timeout: 60_000 }).catch((error: unknown) => {
      if (this.isCertificateNumberConflict(error) && input.certificateNumber) {
        throw new ConflictException(`Certificate number "${input.certificateNumber}" already exists.`);
      }
      throw error;
    });
    await this.events.emit('certificate.issued', { certificateId: cert.id, certificateNumber: cert.certificateNumber, status: cert.status, actorId });
    return { ...cert, qrUrl: this.qrUrl(cert.verificationId) };
  }

  async createFromApplication(
    applicationId: string,
    input: z.infer<typeof createCertificateFromApplicationInput>,
    actorId: string,
  ) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId }, select: { status: true } });
    if (!app) throw new NotFoundException('Application not found');
    if (app.status !== 'COMPLETED' && app.status !== 'DELIVERED') {
      throw new ConflictException('A certificate can be issued only for a completed or delivered application.');
    }
    return this.create({ ...input, applicationId }, actorId);
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

  async listForCustomer(user: AuthUser) {
    // ADMIN_ACCESS only means "may open the admin portal" (every staff role has it) — not a permission.
    const isStaff = user.permissions.includes(PERMS.CERTIFICATES_MANAGE);

    let where: Prisma.CertificateWhereInput;

    if (isStaff) {
      where = {};
    } else {
      // Only certificates linked to the customer's own entity or application. Never match on organisation
      // name: anyone can create a business entity called "Acme Pvt Ltd" and would then see Acme's certificates.
      where = {
        OR: [{ businessEntity: { ownerId: user.id } }, { application: { customerId: user.id } }],
      };
    }

    const certs = await this.prisma.certificate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        certificationBody: { select: { name: true, accreditation: true, website: true } },
      },
    });

    const items = await Promise.all(
      certs.map(async (c) => {
        const qrUrl = this.qrUrl(c.verificationId);
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 200 });
        const daysUntilExpiry = Math.ceil((c.validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        const effectiveStatus = effectiveCertificateStatus(c.status, c.validUntil);
        const isExpiringSoon = c.status === 'ACTIVE' && daysUntilExpiry <= 30 && daysUntilExpiry > 0;

        return {
          id: c.id,
          certificateNumber: c.certificateNumber,
          verificationId: c.verificationId,
          type: c.type,
          organizationName: c.organizationName,
          scope: c.scope,
          address: c.address,
          issueDate: c.issueDate.toISOString(),
          validFrom: c.validFrom.toISOString(),
          validUntil: c.validUntil.toISOString(),
          certificationBody: c.certificationBody,
          status: c.status,
          effectiveStatus,
          pdfAvailable: Boolean(c.pdfKey),
          qrUrl,
          qrDataUrl,
          daysUntilExpiry,
          isExpiringSoon,
          createdAt: c.createdAt.toISOString(),
          applicationId: c.applicationId ?? null,
        };
      }),
    );

    return { items, total: items.length };
  }

  async getForCustomer(id: string, user: AuthUser) {
    // ADMIN_ACCESS only means "may open the admin portal" (every staff role has it) — not a permission.
    const isStaff = user.permissions.includes(PERMS.CERTIFICATES_MANAGE);

    const cert = await this.prisma.certificate.findUnique({
      where: { id },
      include: {
        businessEntity: { select: { ownerId: true, legalName: true } },
        application: { select: { customerId: true } },
        certificationBody: { select: { name: true, accreditation: true, website: true } },
      },
    });

    if (!cert) throw new NotFoundException('Certificate not found');

    if (!isStaff && cert.businessEntity?.ownerId !== user.id && cert.application?.customerId !== user.id) {
      throw new NotFoundException('Certificate not found');
    }

    const qrUrl = this.qrUrl(cert.verificationId);
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { margin: 1, width: 240 });
    const daysUntilExpiry = Math.ceil((cert.validUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const effectiveStatus = effectiveCertificateStatus(cert.status, cert.validUntil);
    const isExpiringSoon = cert.status === 'ACTIVE' && daysUntilExpiry <= 30 && daysUntilExpiry > 0;

    return {
      id: cert.id,
      certificateNumber: cert.certificateNumber,
      verificationId: cert.verificationId,
      type: cert.type,
      organizationName: cert.organizationName,
      scope: cert.scope,
      address: cert.address,
      issueDate: cert.issueDate.toISOString(),
      validFrom: cert.validFrom.toISOString(),
      validUntil: cert.validUntil.toISOString(),
      certificationBody: cert.certificationBody,
      status: cert.status,
      effectiveStatus,
      pdfAvailable: Boolean(cert.pdfKey),
      qrUrl,
      qrDataUrl,
      daysUntilExpiry,
      isExpiringSoon,
      createdAt: cert.createdAt.toISOString(),
      applicationId: cert.applicationId ?? null,
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

  async validateCsv(csv: string) {
    const rawRows = parseCsv(csv);
    if (rawRows.length < 2) {
      throw new BadRequestException('CSV file must contain a header row and at least one data row');
    }

    const headerRow = rawRows[0];
    const mapping = mapHeaders(headerRow);

    const requiredFields = [
      { key: 'type', label: 'Certificate Type' },
      { key: 'organizationName', label: 'Organization Name' },
      { key: 'validFrom', label: 'Valid From' },
      { key: 'validUntil', label: 'Valid Until' },
      { key: 'certificationBody', label: 'Certification Body' },
    ];

    const missingColumns = requiredFields
      .filter((rf) => mapping[rf.key] === undefined)
      .map((rf) => rf.label);

    if (missingColumns.length > 0) {
      throw new BadRequestException(`Missing required columns in CSV header: ${missingColumns.join(', ')}`);
    }

    const bodies = await this.prisma.certificationBody.findMany({
      select: { id: true, name: true },
    });
    const bodyById = new Map<string, { id: string; name: string }>();
    const bodyByName = new Map<string, { id: string; name: string }>();
    for (const b of bodies) {
      bodyById.set(b.id.toLowerCase(), b);
      bodyByName.set(b.name.trim().toLowerCase(), b);
    }

    const csvCertNumbers: string[] = [];
    const certNumberIndex = mapping.certificateNumber;
    for (let r = 1; r < rawRows.length; r++) {
      if (certNumberIndex !== undefined && rawRows[r][certNumberIndex]) {
        const num = rawRows[r][certNumberIndex].trim();
        if (num) csvCertNumbers.push(num);
      }
    }

    const existingCerts =
      csvCertNumbers.length > 0
        ? await this.prisma.certificate.findMany({
            where: { certificateNumber: { in: csvCertNumbers, mode: 'insensitive' } },
            select: { certificateNumber: true },
          })
        : [];
    const existingNumberSet = new Set(existingCerts.map((c) => c.certificateNumber.toLowerCase()));

    const errors: CertificateImportRowError[] = [];
    const validRows: (CertificateImportPreviewRow & { validFromDate: Date; validUntilDate: Date; issueDateDate: Date })[] = [];
    const seenCsvNumbers = new Map<string, number>();

    const dataRows = rawRows.slice(1);
    const totalRows = dataRows.length;

    for (let idx = 0; idx < dataRows.length; idx++) {
      const row = dataRows[idx];
      const rowNumber = idx + 2;
      let hasError = false;

      const getVal = (fieldKey: string): string => {
        const colIdx = mapping[fieldKey];
        return colIdx !== undefined && row[colIdx] !== undefined ? row[colIdx].trim() : '';
      };

      const type = getVal('type');
      const orgName = getVal('organizationName');
      const rawIssueDate = getVal('issueDate');
      const rawValidFrom = getVal('validFrom');
      const rawValidUntil = getVal('validUntil');
      const rawBody = getVal('certificationBody');
      const certNumber = getVal('certificateNumber');
      const scope = getVal('scope') || undefined;
      const address = getVal('address') || undefined;
      const showPdfPublicly = parseCsvBoolean(getVal('showPdfPublicly'));

      if (!orgName || orgName.length < 2) {
        errors.push({ rowNumber, field: 'organizationName', message: 'Organisation name is required (minimum 2 characters)' });
        hasError = true;
      } else if (orgName.length > 200) {
        errors.push({ rowNumber, field: 'organizationName', message: 'Organisation name cannot exceed 200 characters' });
        hasError = true;
      }

      if (!type || type.length < 2) {
        errors.push({ rowNumber, field: 'type', message: 'Certificate type is required (minimum 2 characters)' });
        hasError = true;
      } else if (type.length > 120) {
        errors.push({ rowNumber, field: 'type', message: 'Certificate type cannot exceed 120 characters' });
        hasError = true;
      }

      const validFromDate = parseCsvDate(rawValidFrom);
      if (!validFromDate) {
        errors.push({ rowNumber, field: 'validFrom', message: 'Valid from date is required and must be a valid date' });
        hasError = true;
      }

      const validUntilDate = parseCsvDate(rawValidUntil);
      if (!validUntilDate) {
        errors.push({ rowNumber, field: 'validUntil', message: 'Valid until date is required and must be a valid date' });
        hasError = true;
      }

      if (validFromDate && validUntilDate && validUntilDate <= validFromDate) {
        errors.push({ rowNumber, field: 'validUntil', message: 'Valid until must be after valid from' });
        hasError = true;
      }

      const issueDateDate = parseCsvDate(rawIssueDate) || validFromDate || new Date();

      let matchedBody: { id: string; name: string } | undefined;
      if (!rawBody) {
        errors.push({ rowNumber, field: 'certificationBody', message: 'Certification body is required' });
        hasError = true;
      } else {
        matchedBody = bodyById.get(rawBody.toLowerCase()) || bodyByName.get(rawBody.trim().toLowerCase());
        if (!matchedBody) {
          errors.push({
            rowNumber,
            field: 'certificationBody',
            message: `Certification body "${rawBody}" was not found. Please create it under Certification Bodies first.`,
          });
          hasError = true;
        }
      }

      if (certNumber) {
        if (certNumber.length < 3 || certNumber.length > 64) {
          errors.push({ rowNumber, field: 'certificateNumber', message: 'Certificate number must be between 3 and 64 characters' });
          hasError = true;
        } else {
          const lowerNum = certNumber.toLowerCase();
          const prevRow = seenCsvNumbers.get(lowerNum);
          if (prevRow !== undefined) {
            errors.push({
              rowNumber,
              field: 'certificateNumber',
              message: `Duplicate certificate number "${certNumber}" in CSV (already in row ${prevRow})`,
            });
            hasError = true;
          } else {
            seenCsvNumbers.set(lowerNum, rowNumber);
          }

          if (existingNumberSet.has(lowerNum)) {
            errors.push({ rowNumber, field: 'certificateNumber', message: `Certificate number "${certNumber}" already exists in the database` });
            hasError = true;
          }
        }
      }

      if (scope && scope.length > 1000) {
        errors.push({ rowNumber, field: 'scope', message: 'Scope cannot exceed 1000 characters' });
        hasError = true;
      }
      if (address && address.length > 500) {
        errors.push({ rowNumber, field: 'address', message: 'Address cannot exceed 500 characters' });
        hasError = true;
      }

      if (!hasError && matchedBody && validFromDate && validUntilDate) {
        validRows.push({
          rowNumber,
          certificateNumber: certNumber || undefined,
          type,
          organizationName: orgName,
          scope,
          address,
          issueDate: issueDateDate.toISOString().slice(0, 10),
          validFrom: validFromDate.toISOString().slice(0, 10),
          validUntil: validUntilDate.toISOString().slice(0, 10),
          certificationBodyId: matchedBody.id,
          certificationBodyName: matchedBody.name,
          showPdfPublicly,
          validFromDate,
          validUntilDate,
          issueDateDate,
        });
      }
    }

    const invalidRowsCount = new Set(errors.map((e) => e.rowNumber)).size;
    return {
      totalRows,
      validRows,
      invalidRowsCount,
      errors,
    };
  }

  async previewImport(csv: string): Promise<CertificateImportPreviewResponse> {
    const { totalRows, validRows, invalidRowsCount, errors } = await this.validateCsv(csv);
    return {
      totalRows,
      validRows: validRows.length,
      invalidRows: invalidRowsCount,
      errors,
      preview: validRows.slice(0, 10).map(({ validFromDate: _vf, validUntilDate: _vu, issueDateDate: _id, ...r }) => r),
    };
  }

  async importCertificates(csv: string, actorId: string): Promise<CertificateImportResponse> {
    const { validRows, invalidRowsCount, errors } = await this.validateCsv(csv);
    if (errors.length > 0) {
      const existingNumber = errors.find(({ field, message }) => field === 'certificateNumber' && message.includes('already exists in the database'));
      if (existingNumber) throw new ConflictException(existingNumber.message);
      throw new BadRequestException({
        statusCode: 400,
        message: `Cannot import CSV: found ${errors.length} validation error(s) across ${invalidRowsCount} row(s).`,
        errors,
      });
    }
    if (validRows.length === 0) {
      throw new BadRequestException('No valid rows found to import');
    }

    let conflictNumber: string | undefined;
    const created = await this.prisma.$transaction(async (tx) => {
      const results = [];

      for (const row of validRows) {
        let certNumber = row.certificateNumber;
        if (!certNumber) {
          certNumber = await this.getNextCertificateNumber(tx);
        } else {
          await this.syncManualCertificateNumber(tx, certNumber);
        }
        conflictNumber = certNumber;

        const cert = await tx.certificate.create({
          data: {
            certificateNumber: certNumber,
            verificationId: newVerificationId(),
            type: row.type,
            organizationName: row.organizationName,
            scope: row.scope,
            address: row.address,
            issueDate: row.issueDateDate,
            validFrom: row.validFromDate,
            validUntil: row.validUntilDate,
            certificationBodyId: row.certificationBodyId,
            showPdfPublicly: row.showPdfPublicly,
            status: row.validUntilDate.getTime() < Date.now() ? 'EXPIRED' : 'ACTIVE',
          },
        });
        results.push(cert);
      }

      await this.audit.log(
        {
          actorId,
          action: 'certificate.bulk_import',
          entityType: 'Certificate',
          entityId: results[0].id,
          after: {
            importedCount: results.length,
            firstCertificateNumber: results[0].certificateNumber,
            lastCertificateNumber: results[results.length - 1].certificateNumber,
          },
        },
        tx,
      );

      return results;
    }, { maxWait: 60_000, timeout: 60_000 }).catch((error: unknown) => {
      if (this.isCertificateNumberConflict(error) && conflictNumber) {
        throw new ConflictException(`Certificate number "${conflictNumber}" already exists.`);
      }
      throw error;
    });

    for (const cert of created) {
      await this.events.emit('certificate.issued', {
        certificateId: cert.id,
        certificateNumber: cert.certificateNumber,
        status: cert.status,
        actorId,
      });
    }

    return {
      success: true,
      importedCount: created.length,
      certificateIds: created.map((c) => c.id),
    };
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

