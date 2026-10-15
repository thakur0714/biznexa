import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventBus } from '../events/event-bus';
import {
  AuthUser,
} from '../common/auth.decorators';
import {
  AdminDocumentReviewQueueQuery,
  AdminDocumentReviewQueuePage,
  RequestAdditionalDocumentInput,
  ApplicationStatus,
  assertTransition,
  canTransition,
} from '@biznexa/types';
import { applicationScope } from './application-access';
import { ApplicationStatusService, StatusChanged } from './application-status.service';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class AdminApplicationDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly status: ApplicationStatusService,
  ) {}

  async getReviewQueue(u: AuthUser, query: AdminDocumentReviewQueueQuery): Promise<AdminDocumentReviewQueuePage> {
    const scope = applicationScope(u);
    const where = {
      isLatest: true,
      status: 'UPLOADED' as const,
      application: scope,
    };

    const [total, items] = await Promise.all([
      this.prisma.applicationDocument.count({ where }),
      this.prisma.applicationDocument.findMany({
        where,
        orderBy: { uploadedAt: 'asc' }, // oldest first
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          application: {
            select: {
              id: true,
              code: true,
              customerId: true,
            },
          },
        },
      }),
    ]);

    const customers = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(items.map((doc) => doc.application.customerId))] } },
      select: { id: true, name: true, email: true },
    });
    const customerById = new Map(customers.map((c) => [c.id, { name: c.name, email: c.email }]));

    return {
      items: items.map(doc => ({
        id: doc.id,
        requirementId: doc.requirementId,
        name: doc.name,
        status: doc.status,
        version: doc.version,
        fileKey: doc.fileKey,
        fileName: doc.fileName,
        sizeBytes: doc.sizeBytes,
        mimeType: doc.mimeType,
        uploadedAt: doc.uploadedAt?.toISOString() ?? null,
        application: {
          id: doc.application.id,
          code: doc.application.code,
          customer: customerById.get(doc.application.customerId) ?? null,
        },
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Moves the application after a document change (M4.8): any rejected or requested document → DOCUMENTS_PENDING;
   * every applicable mandatory requirement and every other latest document approved → DOCUMENTS_APPROVED (through
   * DOCUMENTS_UNDER_REVIEW when the application is SUBMITTED or DOCUMENTS_PENDING — a re-upload does not move it).
   * Only moves the state machine allows; anything else (e.g. a DRAFT application) is left as it is.
   * Returns the status events to emit after the commit, in order.
   */
  private async updateApplicationStatusIfNeeded(tx: Prisma.TransactionClient, applicationId: string, u: AuthUser): Promise<StatusChanged[]> {
    const app = await tx.application.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, packageId: true, serviceId: true },
    });
    if (!app) return [];
    const status = app.status as ApplicationStatus;

    const requirements = await tx.serviceDocumentRequirement.findMany({
      where: { serviceId: app.serviceId, isMandatory: true },
      select: { id: true, packageIds: true },
    });
    const documents = await tx.applicationDocument.findMany({
      where: { applicationId, isLatest: true },
      select: { requirementId: true, status: true },
    });

    const needsCustomer = documents.some((d) => d.status === 'REJECTED' || d.status === 'REQUIRED');
    const mandatoryApproved = requirements
      .filter((r) => r.packageIds.length === 0 || r.packageIds.includes(app.packageId))
      .every((r) => documents.some((d) => d.requirementId === r.id && d.status === 'APPROVED'));
    const allApproved = mandatoryApproved && documents.every((d) => d.status === 'APPROVED');

    const move = (to: ApplicationStatus) => this.status.transitionIn(tx, { applicationId, to, actorId: u.id });

    if (needsCustomer) {
      if (status !== 'DOCUMENTS_PENDING' && canTransition('application', status, 'DOCUMENTS_PENDING')) return [await move('DOCUMENTS_PENDING')];
      return [];
    }
    if (!allApproved) return [];
    if (status === 'DOCUMENTS_UNDER_REVIEW') return [await move('DOCUMENTS_APPROVED')];
    if (status === 'SUBMITTED' || status === 'DOCUMENTS_PENDING') {
      const first = await move('DOCUMENTS_UNDER_REVIEW');
      return [first, await move('DOCUMENTS_APPROVED')];
    }
    return [];
  }

  async approveDocument(id: string, u: AuthUser) {
    const scope = applicationScope(u);
    let events: StatusChanged[] = [];
    let docId = '';

    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.applicationDocument.findFirst({
        where: { id, isLatest: true, application: scope },
        include: { application: true },
      });
      if (!doc) throw new NotFoundException('Document not found or access denied');
      docId = doc.id;

      assertTransition('document', doc.status, 'APPROVED');

      await tx.applicationDocument.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: u.id,
          reviewedAt: new Date(),
        },
      });

      await this.audit.log({
        actorId: u.id,
        action: 'document.approve',
        entityType: 'ApplicationDocument',
        entityId: id,
        before: { status: doc.status },
        after: { status: 'APPROVED' },
      }, tx);

      events = await this.updateApplicationStatusIfNeeded(tx, doc.applicationId, u);
    });

    for (const event of events) await this.events.emit('application.status_changed', event);

    return { id: docId, status: 'APPROVED' };
  }

  async rejectDocument(id: string, reason: string, u: AuthUser) {
    const scope = applicationScope(u);
    let events: StatusChanged[] = [];
    let docId = '';

    await this.prisma.$transaction(async (tx) => {
      const doc = await tx.applicationDocument.findFirst({
        where: { id, isLatest: true, application: scope },
        include: { application: true },
      });
      if (!doc) throw new NotFoundException('Document not found or access denied');
      docId = doc.id;

      assertTransition('document', doc.status, 'REJECTED');

      await tx.applicationDocument.update({
        where: { id },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          reviewedById: u.id,
          reviewedAt: new Date(),
        },
      });

      await this.audit.log({
        actorId: u.id,
        action: 'document.reject',
        entityType: 'ApplicationDocument',
        entityId: id,
        before: { status: doc.status },
        after: { status: 'REJECTED', rejectionReason: reason },
      }, tx);

      events = await this.updateApplicationStatusIfNeeded(tx, doc.applicationId, u);
    });

    for (const event of events) await this.events.emit('application.status_changed', event);

    return { id: docId, status: 'REJECTED' };
  }

  async requestAdditionalDocument(applicationId: string, input: RequestAdditionalDocumentInput, u: AuthUser) {
    const scope = applicationScope(u);
    let events: StatusChanged[] = [];
    let docId = '';

    await this.prisma.$transaction(async (tx) => {
      const app = await tx.application.findFirst({
        where: { AND: [{ id: applicationId }, scope] },
      });
      if (!app) throw new NotFoundException('Application not found or access denied');

      const doc = await tx.applicationDocument.create({
        data: {
          applicationId,
          name: input.name,
          version: 1,
          isLatest: true,
          status: 'REQUIRED',
        },
      });
      docId = doc.id;

      await this.audit.log({
        actorId: u.id,
        action: 'document.request',
        entityType: 'ApplicationDocument',
        entityId: doc.id,
        before: null,
        after: { name: input.name, description: input.description, status: 'REQUIRED' },
      }, tx);

      events = await this.updateApplicationStatusIfNeeded(tx, applicationId, u);
    });

    for (const event of events) await this.events.emit('application.status_changed', event);

    return { id: docId, status: 'REQUIRED' };
  }
}
