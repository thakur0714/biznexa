import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminPaymentDetail, AdminPaymentListQuery } from '@biznexa/types';

function escapeCsvCell(val: string | number | null | undefined): string {
  if (val == null) return '""';
  let s = String(val);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const SUCCESS_STATUSES = ['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
const PENDING_STATUSES = ['CREATED', 'PENDING'] as const;

@Injectable()
export class AdminPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(params: AdminPaymentListQuery): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {};

    if (params.status === 'success') {
      where.status = { in: [...SUCCESS_STATUSES] };
    } else if (params.status === 'failed') {
      where.status = 'FAILED';
    } else if (params.status === 'pending') {
      where.status = { in: [...PENDING_STATUSES] };
    }

    if (params.from || params.to) {
      const fromDate = params.from ? new Date(params.from) : undefined;
      const toDate = params.to ? new Date(params.to) : undefined;

      const rangeFilter = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      };

      where.OR = [
        { paidAt: rangeFilter },
        { paidAt: null, createdAt: rangeFilter },
      ];
    }

    if (params.q) {
      const q = params.q.trim();
      where.order = {
        OR: [
          { code: { contains: q, mode: 'insensitive' } },
          { applications: { some: { code: { contains: q.toUpperCase() } } } },
          { customer: { email: { contains: q.toLowerCase() } } },
          { customer: { mobile: { contains: q } } },
        ],
      };
    }

    return where;
  }

  async list(params: AdminPaymentListQuery) {
    const where = this.buildWhere(params);
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: {
          id: true,
          gateway: true,
          gatewayOrderId: true,
          gatewayPaymentId: true,
          amount: true,
          method: true,
          status: true,
          failureReason: true,
          paidAt: true,
          createdAt: true,
          order: {
            select: {
              code: true,
              customer: { select: { name: true, email: true } },
              applications: { take: 1, orderBy: { createdAt: 'asc' }, select: { code: true } },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    const formatted = items.map((p) => ({
      id: p.id,
      gateway: p.gateway,
      gatewayOrderId: p.gatewayOrderId,
      gatewayPaymentId: p.gatewayPaymentId,
      amount: p.amount,
      method: p.method,
      status: p.status,
      failureReason: p.failureReason,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      orderCode: p.order?.code ?? null,
      applicationCode: p.order?.applications[0]?.code ?? null,
      customerName: p.order?.customer.name ?? null,
      customerEmail: p.order?.customer.email ?? null,
    }));

    return { items: formatted, total, page: params.page, limit: params.limit };
  }

  async get(id: string): Promise<AdminPaymentDetail> {
    const p = await this.prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        gateway: true,
        gatewayOrderId: true,
        gatewayPaymentId: true,
        amount: true,
        method: true,
        status: true,
        failureReason: true,
        paidAt: true,
        createdAt: true,
        order: {
          select: {
            code: true,
            customer: { select: { name: true, email: true, mobile: true } },
            applications: { take: 1, orderBy: { createdAt: 'asc' }, select: { code: true } },
          },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, amount: true, reason: true, status: true, createdAt: true },
        },
        invoice: { select: { id: true, number: true, issuedAt: true } },
      },
    });

    if (!p) throw new NotFoundException('Payment not found');

    return {
      id: p.id,
      gateway: p.gateway,
      gatewayOrderId: p.gatewayOrderId,
      gatewayPaymentId: p.gatewayPaymentId,
      amount: p.amount,
      method: p.method,
      status: p.status,
      failureReason: p.failureReason,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
      createdAt: p.createdAt.toISOString(),
      orderCode: p.order?.code ?? null,
      applicationCode: p.order?.applications[0]?.code ?? null,
      customerName: p.order?.customer.name ?? null,
      customerEmail: p.order?.customer.email ?? null,
      customerMobile: p.order?.customer.mobile ?? null,
      refunds: p.refunds.map((r) => ({
        id: r.id,
        amount: r.amount,
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      invoice: p.invoice
        ? {
            id: p.invoice.id,
            number: p.invoice.number,
            issuedAt: p.invoice.issuedAt.toISOString(),
          }
        : null,
    };
  }

  async exportCsv(params: Omit<AdminPaymentListQuery, 'page' | 'limit'>): Promise<string> {
    const where = this.buildWhere({ ...params, page: 1, limit: 10000 });
    const count = await this.prisma.payment.count({ where });

    if (count > 10000) {
      throw new BadRequestException('Export exceeds maximum limit of 10,000 rows. Narrow your date or status filters.');
    }

    const items = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10000,
      select: {
        createdAt: true,
        paidAt: true,
        amount: true,
        status: true,
        method: true,
        gatewayPaymentId: true,
        order: {
          select: {
            code: true,
            customer: { select: { name: true, email: true } },
            applications: { take: 1, orderBy: { createdAt: 'asc' }, select: { code: true } },
          },
        },
        invoice: { select: { number: true } },
      },
    });

    const headers = [
      'Created',
      'Paid',
      'Order Code',
      'Application Code',
      'Customer Name',
      'Customer Email',
      'Amount (₹)',
      'Status',
      'Method',
      'Gateway Payment ID',
      'Invoice Number',
    ];

    const rows = items.map((p) => [
      escapeCsvCell(p.createdAt.toISOString().slice(0, 10)),
      escapeCsvCell(p.paidAt ? p.paidAt.toISOString().slice(0, 10) : ''),
      escapeCsvCell(p.order?.code ?? ''),
      escapeCsvCell(p.order?.applications[0]?.code ?? ''),
      escapeCsvCell(p.order?.customer.name ?? ''),
      escapeCsvCell(p.order?.customer.email ?? ''),
      escapeCsvCell((p.amount / 100).toFixed(2)),
      escapeCsvCell(p.status),
      escapeCsvCell(p.method ?? ''),
      escapeCsvCell(p.gatewayPaymentId ?? ''),
      escapeCsvCell(p.invoice?.number ?? ''),
    ]);

    return [headers.map(escapeCsvCell).join(','), ...rows.map((r) => r.join(','))].join('\n');
  }
}
