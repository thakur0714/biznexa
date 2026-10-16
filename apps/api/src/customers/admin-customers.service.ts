import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AdminCustomerDetail, AdminCustomerListQuery, AdminCustomerRow } from '@biznexa/types';

@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(params: AdminCustomerListQuery): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {
      roles: { some: { role: { key: 'CUSTOMER' } } },
    };

    if (params.status) {
      where.status = params.status;
    }

    if (params.q) {
      const q = params.q.trim();
      // Since User does not have an explicitly named inverse relation for Application.customerId,
      // but applications belong to orders, and users own orders:
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { mobile: { contains: q, mode: 'insensitive' } },
        { orders: { some: { applications: { some: { code: q } } } } },
      ];
    }

    return where;
  }

  async list(params: AdminCustomerListQuery) {
    const where = this.buildWhere(params);
    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: {
          id: true,
          name: true,
          email: true,
          mobile: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    // To count applications, we query Application directly grouping by customerId
    const userIds = users.map((u) => u.id);
    const appCounts = await this.prisma.application.groupBy({
      by: ['customerId'],
      where: { customerId: { in: userIds } },
      _count: { id: true },
    });
    const countMap = new Map(appCounts.map((a) => [a.customerId, a._count.id]));

    const items: AdminCustomerRow[] = users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      status: u.status as AdminCustomerRow['status'],
      createdAt: u.createdAt.toISOString(),
      applicationCount: countMap.get(u.id) || 0,
    }));

    return {
      items,
      total,
      page: params.page,
      limit: params.limit,
    };
  }

  async detail(id: string): Promise<AdminCustomerDetail> {
    const user = await this.prisma.user.findFirst({
      where: { id, roles: { some: { role: { key: 'CUSTOMER' } } } },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        status: true,
        createdAt: true,
        businessEntities: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, legalName: true, entityType: true },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            total: true,
            amountPaid: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Customer not found');
    }

    const applications = await this.prisma.application.findMany({
      where: { customerId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        code: true,
        status: true,
        service: { select: { name: true } },
        createdAt: true,
      },
    });

    const payments = await this.prisma.payment.findMany({
      where: { order: { customerId: id } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        amount: true,
        status: true,
        createdAt: true,
      },
    });

    return {
      profile: {
        id: user.id,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        status: user.status as AdminCustomerDetail['profile']['status'],
        createdAt: user.createdAt.toISOString(),
      },
      businessEntities: user.businessEntities.map((e) => ({
        id: e.id,
        name: e.legalName,
        type: e.entityType,
      })),
      applications: applications.map((a) => ({
        id: a.id,
        code: a.code,
        status: a.status as AdminCustomerDetail['applications'][number]['status'],
        serviceName: a.service.name,
        createdAt: a.createdAt.toISOString(),
      })),
      orders: user.orders.map((o) => ({
        id: o.id,
        code: o.code,
        total: o.total,
        amountPaid: o.amountPaid,
        status: o.status as AdminCustomerDetail['orders'][number]['status'],
        createdAt: o.createdAt.toISOString(),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        status: p.status as AdminCustomerDetail['payments'][number]['status'],
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }
}
