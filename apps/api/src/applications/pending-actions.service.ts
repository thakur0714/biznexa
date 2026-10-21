import { Injectable } from '@nestjs/common';
import { needsUpload, type PendingAction, type PendingActionsResponse } from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationDocumentsService } from './application-documents.service';

type ApplicationRow = {
  id: string;
  code: string;
  service: { name: string };
  order: { status: string; total: number; amountPaid: number } | null;
  conversation: { messages: { id: string }[] } | null;
};
type Checklist = Awaited<ReturnType<ApplicationDocumentsService['listForCustomer']>>[number]['checklist'];

/** Documents still to upload: mandatory ones never uploaded, and anything rejected or requested later. */
function documentActions(checklist: Checklist, application: ApplicationRow): PendingAction[] {
  const href = `/dashboard/applications/${application.id}?tab=documents`;
  const action = (name: string, reupload: boolean): PendingAction => ({
    kind: reupload ? 'reupload_document' : 'upload_document',
    applicationId: application.id,
    applicationCode: application.code,
    serviceName: application.service.name,
    title: `${reupload ? 'Re-upload' : 'Upload'} ${name}`,
    href,
  });
  const required = checklist.items
    .filter((item) => needsUpload(item) && (item.requirement.isMandatory || item.current !== null))
    .map((item) => action(item.requirement.name, item.current !== null));
  const additional = checklist.additional.filter((item) => needsUpload(item)).map((item) => action(item.request.name, item.current !== null));
  return [...required, ...additional];
}

/** A balance to pay and unread messages from the team. */
function applicationActions(application: ApplicationRow): PendingAction[] {
  const context = { applicationId: application.id, applicationCode: application.code, serviceName: application.service.name };
  const actions: PendingAction[] = [];
  const order = application.order;
  if (order?.status === 'PARTIALLY_PAID' && order.total > order.amountPaid) {
    actions.push({ kind: 'pay_balance', ...context, title: 'Pay the remaining balance', href: `/dashboard/applications/${application.id}?tab=payments` });
  }
  if (application.conversation?.messages.length) {
    actions.push({ kind: 'read_message', ...context, title: 'Read a new message from our team', href: `/dashboard/applications/${application.id}?tab=messages` });
  }
  return actions;
}

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
      if (application && group.checklist.canUpload) actions.push(...documentActions(group.checklist, application));
    }
    for (const application of applications) actions.push(...applicationActions(application));

    return { items: actions };
  }
}
