import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CustomerPaymentListQuery,
  CustomerPaymentListResponse,
  PaymentStatus,
} from '@biznexa/types';

/**
 * Customer payments history and summary (M5.10).
 * Queries are scoped to the authenticated customer: order.customerId = customerId.
 */
@Injectable()
export class CustomerPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: string, query: CustomerPaymentListQuery): Promise<CustomerPaymentListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      order: {
        customerId,
      },
    };

    const [total, rows, orders] = await Promise.all([
      this.prisma.payment.count({ where }),
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          order: {
            select: {
              id: true,
              code: true,
              total: true,
              amountPaid: true,
              applications: {
                select: {
                  id: true,
                  service: {
                    select: {
                      slug: true,
                    },
                  },
                },
                take: 1,
              },
            },
          },
          invoice: {
            select: {
              id: true,
              number: true,
            },
          },
        },
      }),
      this.prisma.order.findMany({
        where: {
          customerId,
        },
        select: {
          total: true,
          amountPaid: true,
          status: true,
        },
      }),
    ]);

    let totalPaid = 0;
    let outstandingBalance = 0;

    for (const o of orders) {
      totalPaid += o.amountPaid;
      // Only an advance-paid order has a balance due (same rule as the dashboard); unpaid carts are not owed.
      if (o.status === 'PARTIALLY_PAID') {
        const bal = o.total - o.amountPaid;
        if (bal > 0) outstandingBalance += bal;
      }
    }

    const items = rows.map((p) => {
      const order = p.order!;
      const balance = Math.max(0, order.total - order.amountPaid);
      const app = order.applications[0];
      return {
        id: p.id,
        amount: p.amount,
        status: p.status as PaymentStatus,
        method: p.method,
        gateway: p.gateway,
        createdAt: p.createdAt.toISOString(),
        order: {
          id: order.id,
          code: order.code,
          total: order.total,
          amountPaid: order.amountPaid,
          balance,
          applicationId: app?.id ?? null,
          serviceSlug: app?.service.slug ?? null,
        },
        invoice: p.invoice
          ? {
              id: p.invoice.id,
              number: p.invoice.number,
            }
          : null,
      };
    });

    return {
      items,
      total,
      page,
      limit,
      totalPaid,
      outstandingBalance,
    };
  }
}
