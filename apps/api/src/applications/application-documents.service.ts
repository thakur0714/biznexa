import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assertTransition,
  canReplaceDocument,
  canUploadDocuments,
  pendingMandatoryCount,
  requirementApplies,
  type ApplicationDocumentResult,
  type DocumentChecklist,
  type DocumentChecklistItem,
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
 * application's package; there are no REQUIRED rows. Every upload is a new `ApplicationDocument` version
 * for its requirement: the previous one stays, with `isLatest` false. Customers only — staff review is M4.
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

      const file = await tx.storedFile.findFirst({
        where: { id: fileId, ownerId: customerId },
        select: { fileKey: true, originalName: true, mimeType: true, sizeBytes: true, requirementId: true, scanStatus: true, document: { select: { id: true } } },
      });
      if (!file) throw fileProblem('The file could not be found. Upload it again.');
      // The upload checked this requirement's types and size limit only if it was made for it.
      if (file.requirementId !== req.id) throw fileProblem(`This file was not uploaded for “${req.name}”. Upload it again here.`);
      if (file.document) throw fileProblem('This file is already attached. Upload it again to use it here.');
      if (file.scanStatus === 'INFECTED') throw fileProblem('A virus was found in this file. Upload a clean copy.');

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

  /** Mandatory checklist items still needing an upload; pass `db` to count inside a transaction (payment webhook, M3.17). */
  async pendingMandatory(app: AppRow, db: Prisma.TransactionClient = this.prisma): Promise<number> {
    return (await this.build(app, db)).pendingMandatory;
  }

  private async build(app: AppRow, db: Prisma.TransactionClient = this.prisma): Promise<DocumentChecklist> {
    const [requirements, documents] = await Promise.all([
      db.serviceDocumentRequirement.findMany({ where: { serviceId: app.serviceId }, orderBy: { sortOrder: 'asc' }, select: requirementSelect }),
      db.applicationDocument.findMany({
        where: { applicationId: app.id, requirementId: { not: null }, fileKey: { not: null } },
        orderBy: { version: 'desc' },
        select: documentSelect,
      }),
    ]);

    const byRequirement = new Map<string, DocumentRow[]>();
    for (const d of documents) byRequirement.set(d.requirementId!, [...(byRequirement.get(d.requirementId!) ?? []), d]);

    const items: DocumentChecklistItem[] = requirements
      // A requirement later narrowed to other packages still shows here if something was uploaded for it.
      .filter((r) => requirementApplies(r, app.packageId) || byRequirement.has(r.id))
      .map(({ packageIds: _p, ...requirement }) => {
        const versions = (byRequirement.get(requirement.id) ?? []).map(toDocumentDto);
        const [current = null, ...previous] = versions;
        return { requirement, current, previous, canReplace: !current || canReplaceDocument(current.status) };
      });

    return { applicationId: app.id, canUpload: canUploadDocuments(app.status), items, pendingMandatory: pendingMandatoryCount(items) };
  }
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
