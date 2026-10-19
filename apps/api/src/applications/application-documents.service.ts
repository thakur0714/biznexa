import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  canReplaceDocument,
  canUploadDocuments,
  needsUpload,
  pendingMandatoryCount,
  requirementApplies,
  type AdditionalDocumentItem,
  type ApplicationDocumentResult,
  type DocumentChecklist,
  type DocumentChecklistItem,
  type CustomerDocuments,
  type CustomerDocumentsQuery,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { EventBus } from '../events/event-bus';
import { Prisma } from '../generated/prisma/client';

const requirementSelect = {
  id: true,
  name: true,
  description: true,
  isMandatory: true,
  acceptedTypes: true,
  maxSizeMb: true,
  packageIds: true,
} satisfies Prisma.ServiceDocumentRequirementSelect;

const documentSelect = {
  id: true,
  requirementId: true,
  requestId: true,
  version: true,
  isLatest: true,
  status: true,
  rejectionReason: true,
  uploadedAt: true,
  createdAt: true,
  file: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scanStatus: true } },
} satisfies Prisma.ApplicationDocumentSelect;
type DocumentRow = Prisma.ApplicationDocumentGetPayload<{ select: typeof documentSelect }>;

interface AppRow {
  id: string;
  status: string;
  serviceId: string;
  packageId: string;
}

/**
 * The document step (M3.10, D37). The checklist is computed from the service's requirements for the
 * application's package; there are no REQUIRED rows for them. Every upload is a new `ApplicationDocument`
 * version for its requirement: the previous one stays, with `isLatest` false. Documents staff ask for later
 * (M4.8) start as a REQUIRED row with no requirement; its first upload fills that row, later ones are new
 * versions sharing its `requestId`. Customers only — staff review is in AdminApplicationDocumentsService.
 */
@Injectable()
export class ApplicationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  /** The customer's checklist: each requirement with its newest upload and earlier versions. */
  async checklist(customerId: string, applicationId: string): Promise<DocumentChecklist> {
    const app = await this.prisma.application.findFirst({
      where: { id: applicationId, customerId },
      select: { id: true, status: true, serviceId: true, packageId: true },
    });
    if (!app) throw new NotFoundException('Application not found');
    return this.build(app);
  }

  /** All customer-owned applications with document requirements or requested additional documents (M5.9). */
  async listForCustomer(customerId: string, query: CustomerDocumentsQuery): Promise<CustomerDocuments> {
    const applications = await this.prisma.application.findMany({
      where: {
        customerId,
        OR: [
          { service: { documents: { some: {} } } },
          { documents: { some: {} } },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, code: true, status: true, serviceId: true, packageId: true, service: { select: { name: true } } },
    });

    const grouped = await Promise.all(applications.map(async (application) => ({
      applicationId: application.id,
      applicationCode: application.code,
      serviceName: application.service.name,
      checklist: await this.build(application),
    })));

    return grouped.filter(({ checklist }) => {
      if (checklist.items.length + checklist.additional.length === 0) return false;
      if (query.status === 'all') return true;
      return checklist.pendingMandatory > 0 ||
        checklist.items.some((item) => item.current !== null && needsUpload(item)) ||
        checklist.additional.some(needsUpload);
    });
  }

  /**
   * Attach a file the customer uploaded (`POST /api/files?requirementId=`) to one checklist item, as
   * version 1 or as the next version of a replacement. The application row is locked so two uploads
   * for the same item cannot both become version N+1 (the unique index is the backstop).
   */
  async attach(customerId: string, applicationId: string, requirementId: string, fileId: string): Promise<DocumentChecklist> {
    const { app, doc } = await this.prisma.$transaction(async (tx) => {
      const [app] = await tx.$queryRaw<AppRow[]>`
        SELECT id, status::text AS status, "serviceId", "packageId" FROM "Application"
        WHERE id = ${applicationId} AND "customerId" = ${customerId} FOR UPDATE`;
      if (!app) throw new NotFoundException('Application not found');
      if (!canUploadDocuments(app.status)) {
        throw new ConflictException('This application is past the document step, so documents can’t be changed here.');
      }

      const req = await tx.serviceDocumentRequirement.findFirst({ where: { id: requirementId, serviceId: app.serviceId }, select: requirementSelect });
      if (!req || !requirementApplies(req, app.packageId)) throw new NotFoundException('This document is not on this application’s checklist');

      const file = await usableFile(tx, customerId, fileId, req.id, req.name);

      const latest = await tx.applicationDocument.findFirst({
        where: { applicationId: app.id, requirementId: req.id },
        orderBy: { version: 'desc' },
        select: { status: true, version: true },
      });
      if (latest && !canReplaceDocument(latest.status)) {
        throw new ConflictException(
          latest.status === 'APPROVED' ? `“${req.name}” is already approved and can’t be replaced.` : `“${req.name}” is being reviewed and can’t be replaced right now.`,
        );
      }
      assertTransition('document', latest?.status ?? 'REQUIRED', 'UPLOADED');

      await tx.applicationDocument.updateMany({ where: { applicationId: app.id, requirementId: req.id, isLatest: true }, data: { isLatest: false } });
      const doc = await tx.applicationDocument.create({
        data: {
          applicationId: app.id,
          requirementId: req.id,
          name: req.name,
          fileKey: file.fileKey,
          fileName: file.originalName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          version: (latest?.version ?? 0) + 1,
          isLatest: true,
          status: 'UPLOADED',
          uploadedAt: new Date(),
        },
        select: { id: true, version: true },
      });
      return { app, doc };
    });

    await this.events.emit('document.uploaded', { documentId: doc.id, applicationId: app.id, requirementId, version: doc.version, actorId: customerId });
    return this.build(app);
  }

  /**
   * Attach a file uploaded without a requirement (`POST /api/files`) to a document staff asked for (M4.8).
   * The first upload fills the REQUIRED row; a replacement (while waiting or after a rejection) is the
   * next version. Locked like `attach`; the `[requestId, version]` unique index is the backstop.
   */
  async attachAdditional(customerId: string, applicationId: string, requestId: string, fileId: string): Promise<DocumentChecklist> {
    const { app, doc } = await this.prisma.$transaction(async (tx) => {
      const [app] = await tx.$queryRaw<AppRow[]>`
        SELECT id, status::text AS status, "serviceId", "packageId" FROM "Application"
        WHERE id = ${applicationId} AND "customerId" = ${customerId} FOR UPDATE`;
      if (!app) throw new NotFoundException('Application not found');
      if (!canUploadDocuments(app.status)) {
        throw new ConflictException('This application is past the document step, so documents can’t be changed here.');
      }

      const latest = await tx.applicationDocument.findFirst({
        where: { applicationId: app.id, requirementId: null, requestId },
        orderBy: { version: 'desc' },
        select: { id: true, name: true, description: true, status: true, version: true, fileKey: true },
      });
      if (!latest) throw new NotFoundException('This document was not requested on this application');

      const file = await usableFile(tx, customerId, fileId, null, latest.name);
      if (latest.status !== 'REQUIRED' && !canReplaceDocument(latest.status)) {
        throw new ConflictException(
          latest.status === 'APPROVED' ? `“${latest.name}” is already approved and can’t be replaced.` : `“${latest.name}” is being reviewed and can’t be replaced right now.`,
        );
      }
      assertTransition('document', latest.status, 'UPLOADED');

      const upload = {
        fileKey: file.fileKey,
        fileName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: 'UPLOADED' as const,
        rejectionReason: null,
        reviewedById: null,
        reviewedAt: null,
        uploadedAt: new Date(),
      };
      if (!latest.fileKey) {
        const doc = await tx.applicationDocument.update({ where: { id: latest.id }, data: upload, select: { id: true, version: true } });
        return { app, doc };
      }
      await tx.applicationDocument.updateMany({ where: { applicationId: app.id, requestId, isLatest: true }, data: { isLatest: false } });
      const doc = await tx.applicationDocument.create({
        data: { applicationId: app.id, requestId, name: latest.name, description: latest.description, version: latest.version + 1, isLatest: true, ...upload },
        select: { id: true, version: true },
      });
      return { app, doc };
    });

    await this.events.emit('document.uploaded', { documentId: doc.id, applicationId: app.id, requirementId: null, requestId, version: doc.version, actorId: customerId });
    return this.build(app);
  }

  /** Mandatory checklist items still needing an upload; pass `db` to count inside a transaction (payment webhook, M3.17). */
  async pendingMandatory(app: AppRow, db: Prisma.TransactionClient = this.prisma): Promise<number> {
    return (await this.build(app, db)).pendingMandatory;
  }

  /** Batch version of pendingMandatory to avoid N+1 queries. */
  async pendingMandatoryMany(apps: AppRow[], db: Prisma.TransactionClient = this.prisma): Promise<Map<string, number>> {
    if (apps.length === 0) return new Map();

    const applicationIds = apps.map((a) => a.id);
    const serviceIds = [...new Set(apps.map((a) => a.serviceId))];

    const [requirements, documents, requests] = await Promise.all([
      db.serviceDocumentRequirement.findMany({ where: { serviceId: { in: serviceIds } }, orderBy: { sortOrder: 'asc' }, select: { serviceId: true, ...requirementSelect } }),
      db.applicationDocument.findMany({
        where: { applicationId: { in: applicationIds }, fileKey: { not: null } },
        orderBy: { version: 'desc' },
        select: { applicationId: true, ...documentSelect },
      }),
      db.applicationDocument.findMany({
        where: { applicationId: { in: applicationIds }, requirementId: null, requestId: { not: null }, version: 1 },
        orderBy: { createdAt: 'asc' },
        select: { applicationId: true, requestId: true, name: true, description: true, createdAt: true },
      }),
    ]);

    const reqsByService = new Map<string, typeof requirements>();
    for (const r of requirements) {
      reqsByService.set(r.serviceId, [...(reqsByService.get(r.serviceId) ?? []), r]);
    }

    const docsByApp = new Map<string, typeof documents>();
    for (const d of documents) {
      docsByApp.set(d.applicationId, [...(docsByApp.get(d.applicationId) ?? []), d]);
    }

    const requestsByApp = new Map<string, typeof requests>();
    for (const r of requests) {
      requestsByApp.set(r.applicationId, [...(requestsByApp.get(r.applicationId) ?? []), r]);
    }

    const result = new Map<string, number>();

    for (const app of apps) {
      const appReqs = reqsByService.get(app.serviceId) ?? [];
      const appDocs = docsByApp.get(app.id) ?? [];
      const appRequests = requestsByApp.get(app.id) ?? [];

      const byRequirement = new Map<string, DocumentRow[]>();
      const byRequest = new Map<string, DocumentRow[]>();
      for (const d of appDocs) {
        if (d.requirementId) byRequirement.set(d.requirementId, [...(byRequirement.get(d.requirementId) ?? []), d]);
        else if (d.requestId) byRequest.set(d.requestId, [...(byRequest.get(d.requestId) ?? []), d]);
      }

      const items: DocumentChecklistItem[] = appReqs
        .filter((r) => requirementApplies(r, app.packageId) || byRequirement.has(r.id))
        .map(({ packageIds: _p, ...requirement }) => {
          const versions = (byRequirement.get(requirement.id) ?? []).map(toDocumentDto);
          const [current = null, ...previous] = versions;
          return { requirement, current, previous, canReplace: !current || canReplaceDocument(current.status) };
        });

      const additional: AdditionalDocumentItem[] = appRequests.map((r) => {
        const [current = null, ...previous] = (byRequest.get(r.requestId!) ?? []).map(toDocumentDto);
        return {
          request: { id: r.requestId!, name: r.name, description: r.description, requestedAt: r.createdAt.toISOString() },
          current,
          previous,
          canReplace: !current || canReplaceDocument(current.status),
        };
      });

      result.set(app.id, pendingMandatoryCount(items, additional));
    }

    return result;
  }

  private async build(app: AppRow, db: Prisma.TransactionClient = this.prisma): Promise<DocumentChecklist> {
    const [requirements, documents, requests] = await Promise.all([
      db.serviceDocumentRequirement.findMany({ where: { serviceId: app.serviceId }, orderBy: { sortOrder: 'asc' }, select: requirementSelect }),
      db.applicationDocument.findMany({
        where: { applicationId: app.id, fileKey: { not: null } },
        orderBy: { version: 'desc' },
        select: documentSelect,
      }),
      // The first row of each additional document: what staff asked for, and when.
      db.applicationDocument.findMany({
        where: { applicationId: app.id, requirementId: null, requestId: { not: null }, version: 1 },
        orderBy: { createdAt: 'asc' },
        select: { requestId: true, name: true, description: true, createdAt: true },
      }),
    ]);

    const byRequirement = new Map<string, DocumentRow[]>();
    const byRequest = new Map<string, DocumentRow[]>();
    for (const d of documents) {
      if (d.requirementId) byRequirement.set(d.requirementId, [...(byRequirement.get(d.requirementId) ?? []), d]);
      else if (d.requestId) byRequest.set(d.requestId, [...(byRequest.get(d.requestId) ?? []), d]);
    }

    const items: DocumentChecklistItem[] = requirements
      // A requirement later narrowed to other packages still shows here if something was uploaded for it.
      .filter((r) => requirementApplies(r, app.packageId) || byRequirement.has(r.id))
      .map(({ packageIds: _p, ...requirement }) => {
        const versions = (byRequirement.get(requirement.id) ?? []).map(toDocumentDto);
        const [current = null, ...previous] = versions;
        return { requirement, current, previous, canReplace: !current || canReplaceDocument(current.status) };
      });

    const additional: AdditionalDocumentItem[] = requests.map((r) => {
      const [current = null, ...previous] = (byRequest.get(r.requestId!) ?? []).map(toDocumentDto);
      return {
        request: { id: r.requestId!, name: r.name, description: r.description, requestedAt: r.createdAt.toISOString() },
        current,
        previous,
        canReplace: !current || canReplaceDocument(current.status),
      };
    });

    return {
      applicationId: app.id,
      canUpload: canUploadDocuments(app.status),
      items,
      additional,
      pendingMandatory: pendingMandatoryCount(items, additional),
    };
  }
}

/**
 * The customer's own uploaded file, made for this requirement (or for none, for an additional document),
 * not attached anywhere yet and not infected.
 */
async function usableFile(tx: Prisma.TransactionClient, customerId: string, fileId: string, requirementId: string | null, documentName: string) {
  const file = await tx.storedFile.findFirst({
    where: { id: fileId, ownerId: customerId },
    select: { fileKey: true, originalName: true, mimeType: true, sizeBytes: true, requirementId: true, scanStatus: true, document: { select: { id: true } } },
  });
  if (!file) throw fileProblem('The file could not be found. Upload it again.');
  // The upload checked a requirement's types and size limit only if it was made for it.
  if (file.requirementId !== requirementId) throw fileProblem(`This file was not uploaded for “${documentName}”. Upload it again here.`);
  if (file.document) throw fileProblem('This file is already attached. Upload it again to use it here.');
  if (file.scanStatus === 'INFECTED') throw fileProblem('A virus was found in this file. Upload a clean copy.');
  return file;
}

function fileProblem(message: string) {
  return new BadRequestException({ message, errors: [{ field: 'fileId', message }] });
}

function toDocumentDto(d: DocumentRow): ApplicationDocumentResult {
  // Rows are only read with a file (fileKey not null), so `file` is present.
  const f = d.file!;
  return {
    id: d.id,
    version: d.version,
    status: d.status,
    rejectionReason: d.rejectionReason,
    fileId: f.id,
    fileName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    scanStatus: f.scanStatus,
    uploadedAt: (d.uploadedAt ?? d.createdAt).toISOString(),
  };
}
