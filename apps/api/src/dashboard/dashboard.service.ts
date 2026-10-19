import { Injectable } from '@nestjs/common';
import {
  APPLICATION_STATUS_LABEL,
  type DashboardSummary,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationDocumentsService } from '../applications/application-documents.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: ApplicationDocumentsService,
  ) {}

  async summary(customerId: string): Promise<DashboardSummary> {
    const now = new Date();
    const dueBy = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const [activeApplications, orders, applications, certificates, activity] = await Promise.all([
      this.prisma.application.count({
        where: { customerId, status: { notIn: ['DRAFT', 'COMPLETED', 'DELIVERED', 'CANCELLED'] } },
      }),
      // Only an advance-paid order has a balance due; unpaid carts and cancelled orders are not owed.
      this.prisma.order.findMany({ where: { customerId, status: 'PARTIALLY_PAID' }, select: { total: true, amountPaid: true } }),
      this.prisma.application.findMany({
        where: { customerId, status: { in: ['DRAFT', 'PAYMENT_PENDING', 'SUBMITTED', 'DOCUMENTS_UNDER_REVIEW', 'DOCUMENTS_PENDING'] } },
        select: { id: true, status: true, serviceId: true, packageId: true, order: { select: { total: true, amountPaid: true } } },
      }),
      this.prisma.certificate.findMany({
        where: {
          validUntil: { gte: now, lte: dueBy },
          OR: [{ application: { customerId } }, { businessEntity: { ownerId: customerId } }],
        },
        orderBy: { validUntil: 'asc' },
        select: { id: true, certificateNumber: true, type: true, validUntil: true },
      }),
      this.prisma.applicationStageHistory.findMany({
        where: { visibleToCustomer: true, application: { customerId } },
        orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          status: true,
          changedAt: true,
          application: { select: { id: true, code: true, service: { select: { name: true } } } },
        },
      }),
    ]);

    const docsPending = await this.documents.pendingMandatoryMany(applications.map((application) => ({
        id: application.id,
        status: application.status,
        serviceId: application.serviceId,
        packageId: application.packageId,
    })));
    const unpaidOrders = orders.filter((order) => order.total > order.amountPaid).length;

    return {
      activeApplications,
      pendingActions: [...docsPending.values()].reduce((sum, count) => sum + count, 0) + unpaidOrders,
      unpaidBalance: orders.reduce((sum, order) => sum + Math.max(0, order.total - order.amountPaid), 0),
      upcomingDueDates: certificates.map((certificate) => ({
        id: certificate.id,
        number: certificate.certificateNumber,
        type: certificate.type,
        validUntil: certificate.validUntil.toISOString(),
      })),
      recentActivity: activity.map((row) => ({
        applicationId: row.application.id,
        applicationCode: row.application.code,
        serviceName: row.application.service.name,
        status: row.status,
        statusLabel: APPLICATION_STATUS_LABEL[row.status],
        changedAt: row.changedAt.toISOString(),
      })),
    };
  }
}
