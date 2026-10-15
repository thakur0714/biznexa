import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
  DOCUMENT_STATUSES,
  APPLICATION_STATUSES,
  assertTransition,
} from '@biznexa/types';
import { applicationScope } from './application-access';
import { ApplicationStatusService } from './application-status.service';
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
            },
          },
        },
      }),
    ]);

    const applicationIds = items.map(doc => doc.application.id);
    const applications = await this.prisma.application.findMany({
      where: { id: { in: applicationIds } },
      select: {
        id: true,
        customerId: true,
        order: {
          select: {
            customer: {
              select: { name: true, email: true },
            }
          }
        }
      }
    });

    const userIds = applications.filter(a => !a.order).map(a => a.customerId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true }
    });

    const getCustomer = (appId: string) => {
      const app = applications.find(a => a.id === appId);
      if (!app) return null;
      if (app.order?.customer) return app.order.customer;
      const user = users.find(u => u.id === app.customerId);
      return user ? { name: user.name, email: user.email } : null;
    };

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
          customer: getCustomer(doc.application.id),
        },
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private async updateApplicationStatusIfNeeded(tx: Prisma.TransactionClient, applicationId: string, u: AuthUser) {
    const app = await tx.application.findUnique({
      where: { id: applicationId },
      select: { id: true, status: true, packageId: true, serviceId: true },
    });
    if (!app) return null;

    const requirements = await tx.serviceDocumentRequirement.findMany({
      where: { serviceId: app.serviceId },
    });

    const documents = await tx.applicationDocument.findMany({
      where: { applicationId, isLatest: true },
    });

    let allApproved = true;
    let anyRejected = false;

    // Check mandatory requirements
    for (const req of requirements) {
      if (req.packageIds.length > 0 && !req.packageIds.includes(app.packageId)) {
        continue;
      }
      if (req.isMandatory) {
        const doc = documents.find(d => d.requirementId === req.id);
        if (!doc || doc.status !== 'APPROVED') {
          allApproved = false;
        }
      }
    }

    // Check optional requirements and additional documents
    for (const doc of documents) {
      if (doc.status === 'REJECTED') {
        anyRejected = true;
        allApproved = false;
      } else if (doc.status !== 'APPROVED') {
        allApproved = false;
      }
    }

    let event = null;
    if (anyRejected && app.status !== 'DOCUMENTS_PENDING') {
      event = await this.status.transitionIn(tx, {
        applicationId,
        to: 'DOCUMENTS_PENDING',
        actorId: u.id,
      });
    } else if (allApproved && (app.status === 'DOCUMENTS_UNDER_REVIEW' || app.status === 'SUBMITTED' || app.status === 'DOCUMENTS_PENDING')) {
      event = await this.status.transitionIn(tx, {
        applicationId,
        to: 'DOCUMENTS_APPROVED',
        actorId: u.id,
      });
    } else if (!allApproved && (app.status === 'DOCUMENTS_APPROVED' || app.status === 'DOCUMENTS_UNDER_REVIEW')) {
       // if we are in under review and not all are approved, we stay in under review.
       // but if we are in APPROVED and a doc is added, we move to PENDING.
       if (app.status === 'DOCUMENTS_APPROVED') {
         event = await this.status.transitionIn(tx, {
           applicationId,
           to: 'DOCUMENTS_PENDING',
           actorId: u.id,
         });
       }
    }

    return event;
  }

  async approveDocument(id: string, u: AuthUser) {
    const scope = applicationScope(u);
    let event = null;
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

      event = await this.updateApplicationStatusIfNeeded(tx, doc.applicationId, u);
    });

    if (event) {
      await this.events.emit('application.status_changed', event);
    }

    return { id: docId, status: 'APPROVED' };
  }

  async rejectDocument(id: string, reason: string, u: AuthUser) {
    if (!reason || !reason.trim()) {
      throw new BadRequestException('Enter a rejection reason');
    }
    const scope = applicationScope(u);
    let event = null;
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

      event = await this.updateApplicationStatusIfNeeded(tx, doc.applicationId, u);
    });

    if (event) {
      await this.events.emit('application.status_changed', event);
    }

    return { id: docId, status: 'REJECTED' };
  }

  async requestAdditionalDocument(applicationId: string, input: RequestAdditionalDocumentInput, u: AuthUser) {
    const scope = applicationScope(u);
    let event = null;
    let docId = '';

    await this.prisma.$transaction(async (tx) => {
      const app = await tx.application.findFirst({
        where: { id: applicationId, ...scope },
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

      event = await this.updateApplicationStatusIfNeeded(tx, applicationId, u);
    });

    if (event) {
      await this.events.emit('application.status_changed', event);
    }

    return { id: docId, status: 'REQUIRED' };
  }
}
