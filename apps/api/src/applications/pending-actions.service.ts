import { Injectable } from '@nestjs/common';
import { needsUpload, type PendingAction, type PendingActionsResponse } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationDocumentsService } from './application-documents.service';

@Injectable()
export class PendingActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ApplicationDocumentsService,
  ) {}

  async listForCustomer(customerId: string): Promise<PendingActionsResponse> {
    const [applications, documentGroups] = await Promise.all([
      this.prisma.application.findMany({
        where: { customerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          code: true,
          service: { select: { name: true } },
          order: { select: { status: true, total: true, amountPaid: true } },
          conversation: {
            select: {
              messages: {
                where: { senderId: { not: customerId }, readAt: null },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      }),
      this.documents.listForCustomer(customerId, { status: 'needs_action' }),
    ]);

    const actions: PendingAction[] = [];
    const appById = new Map(applications.map((application) => [application.id, application]));

    for (const group of documentGroups) {
      const application = appById.get(group.applicationId);
      if (!application || !group.checklist.canUpload) continue;
      const applicationHref = `/dashboard/applications/${application.id}?tab=documents`;

      for (const item of group.checklist.items) {
        if (!needsUpload(item) || (!item.requirement.isMandatory && item.current === null)) continue;
        const reupload = item.current !== null;
        actions.push({
          kind: reupload ? 'reupload_document' : 'upload_document',
          applicationId: application.id,
          applicationCode: application.code,
          serviceName: application.service.name,
          title: `${reupload ? 'Re-upload' : 'Upload'} ${item.requirement.name}`,
          href: applicationHref,
        });
      }

      for (const item of group.checklist.additional) {
        if (!needsUpload(item)) continue;
        const reupload = item.current !== null;
        actions.push({
          kind: reupload ? 'reupload_document' : 'upload_document',
          applicationId: application.id,
          applicationCode: application.code,
          serviceName: application.service.name,
          title: `${reupload ? 'Re-upload' : 'Upload'} ${item.request.name}`,
          href: applicationHref,
        });
      }
    }

    for (const application of applications) {
      const context = {
        applicationId: application.id,
        applicationCode: application.code,
        serviceName: application.service.name,
      };
      if (application.order?.status === 'PARTIALLY_PAID' && application.order.total > application.order.amountPaid) {
        actions.push({
          kind: 'pay_balance',
          ...context,
          title: 'Pay the remaining balance',
          href: `/dashboard/applications/${application.id}?tab=payments`,
        });
      }
      if (application.conversation?.messages.length) {
        actions.push({
          kind: 'read_message',
          ...context,
          title: 'Read a new message from our team',
          href: `/dashboard/applications/${application.id}?tab=messages`,
        });
      }
    }

    return { items: actions };
  }
}
