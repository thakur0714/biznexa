import { Injectable } from '@nestjs/common';
import {
  type ReportCustomersResponse,
  type ReportDashboardResponse,
  type ReportDateRangeQuery,
  type ReportSalesResponse,
  getDaysInISTRange,
  istDay,
  resolveReportDateRange,
} from '@biznexa/types';
import { PrismaService } from '../prisma/prisma.service';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Builds the dashboard KPIs, series, and needs-attention queue.
   */
  async getDashboard(query: ReportDateRangeQuery, now = new Date()): Promise<ReportDashboardResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);
    const serviceFilter = query.serviceId ? { items: { some: { package: { serviceId: query.serviceId } } } } : {};
    const categoryFilter = query.categoryId ? { items: { some: { package: { service: { categoryId: query.categoryId } } } } } : {};

    // 1. Fetch payments in the range (only successful / received payments)
    const paymentWhere: any = {
      status: { in: ['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
      OR: [{ paidAt: { gte: from, lte: to } }, { paidAt: null, createdAt: { gte: from, lte: to } }],
    };
    if (query.serviceId || query.categoryId) {
      paymentWhere.order = { ...serviceFilter, ...categoryFilter };
    }

    const [payments, ordersList, newCustomersCount, activeAppsCount, rawSlaBreaches, rawWaitingDocs] = await Promise.all([
      this.prisma.payment.findMany({
        where: paymentWhere,
        select: {
          id: true,
          amount: true,
          paidAt: true,
          createdAt: true,
          refunds: {
            where: { status: { not: 'FAILED' } },
            select: { amount: true },
          },
        },
      }),
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          ...serviceFilter,
          ...categoryFilter,
        },
        select: {
          id: true,
          createdAt: true,
          total: true,
        },
      }),
      this.prisma.user.count({
        where: {
          roles: { some: { role: { key: 'CUSTOMER' } } },
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.application.count({
        where: {
          status: { notIn: ['DRAFT', 'COMPLETED', 'DELIVERED', 'CANCELLED'] },
          ...(query.serviceId ? { serviceId: query.serviceId } : {}),
          ...(query.categoryId ? { service: { categoryId: query.categoryId } } : {}),
        },
      }),
      // Needs attention: SLA breaches
      this.prisma.application.findMany({
        where: {
          status: { notIn: ['DRAFT', 'COMPLETED', 'DELIVERED', 'CANCELLED'] },
          slaDueAt: { lt: now },
          ...(query.serviceId ? { serviceId: query.serviceId } : {}),
          ...(query.categoryId ? { service: { categoryId: query.categoryId } } : {}),
        },
        orderBy: { slaDueAt: 'asc' },
        take: 10,
        select: {
          id: true,
          code: true,
          status: true,
          slaDueAt: true,
          customerId: true,
          service: { select: { name: true } },
        },
      }),
      // Needs attention: Documents waiting > 24h
      this.prisma.applicationDocument.findMany({
        where: {
          status: 'UNDER_REVIEW',
          OR: [
            { uploadedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
            { uploadedAt: null, createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
          ],
          ...(query.serviceId ? { application: { serviceId: query.serviceId } } : {}),
          ...(query.categoryId ? { application: { service: { categoryId: query.categoryId } } } : {}),
        },
        orderBy: [{ uploadedAt: 'asc' }, { createdAt: 'asc' }],
        take: 10,
        select: {
          id: true,
          name: true,
          uploadedAt: true,
          createdAt: true,
          application: {
            select: {
              id: true,
              code: true,
              service: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    // Calculate total net revenue (payments amount - refunds)
    let totalRevenue = 0;
    const revenueByDay = new Map<string, number>();
    for (const p of payments) {
      const refundSum = p.refunds.reduce((sum, r) => sum + r.amount, 0);
      const net = Math.max(0, p.amount - refundSum);
      totalRevenue += net;

      const dateInstant = p.paidAt ?? p.createdAt;
      const day = istDay(dateInstant);
      revenueByDay.set(day, (revenueByDay.get(day) ?? 0) + net);
    }

    // Calculate orders count by day
    const ordersByDay = new Map<string, number>();
    for (const o of ordersList) {
      const day = istDay(o.createdAt);
      ordersByDay.set(day, (ordersByDay.get(day) ?? 0) + 1);
    }

    // Build continuous daily series for the entire range
    const days = getDaysInISTRange(from, to);
    const series = days.map((date) => ({
      date,
      revenue: revenueByDay.get(date) ?? 0,
      orders: ordersByDay.get(date) ?? 0,
    }));

    const customerIds = [...new Set(rawSlaBreaches.map((a) => a.customerId))];
    const customers = customerIds.length > 0
      ? await this.prisma.user.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : [];
    const customerNameMap = new Map(customers.map((c) => [c.id, c.name]));

    const slaBreaches = rawSlaBreaches.map((app) => ({
      id: app.id,
      code: app.code,
      serviceName: app.service.name,
      customerName: customerNameMap.get(app.customerId) ?? 'Customer',
      slaDueAt: app.slaDueAt ? app.slaDueAt.toISOString() : '',
      status: app.status,
      link: `/applications/${app.id}`,
    }));

    const waitingDocuments = rawWaitingDocs.map((doc) => ({
      id: doc.id,
      applicationId: doc.application.id,
      applicationCode: doc.application.code,
      serviceName: doc.application.service.name,
      documentName: doc.name,
      uploadedAt: (doc.uploadedAt ?? doc.createdAt).toISOString(),
      link: `/documents`,
    }));

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      kpis: {
        revenue: totalRevenue,
        orders: ordersList.length,
        newCustomers: newCustomersCount,
        activeApplications: activeAppsCount,
      },
      series,
      needsAttention: {
        slaBreaches,
        waitingDocuments,
      },
    };
  }

  /**
   * Builds the Sales report: total, monthly, service-wise, category-wise, coupon impact.
   */
  async getSalesReport(query: ReportDateRangeQuery, now = new Date()): Promise<ReportSalesResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);
    const serviceFilter = query.serviceId ? { items: { some: { package: { serviceId: query.serviceId } } } } : {};
    const categoryFilter = query.categoryId ? { items: { some: { package: { service: { categoryId: query.categoryId } } } } } : {};

    const [orders, payments] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          createdAt: { gte: from, lte: to },
          ...serviceFilter,
          ...categoryFilter,
        },
        select: {
          id: true,
          total: true,
          discount: true,
          couponId: true,
          createdAt: true,
          coupon: {
            select: {
              code: true,
              type: true,
            },
          },
          items: {
            select: {
              professionalFee: true,
              governmentFee: true,
              discount: true,
              package: {
                select: {
                  id: true,
                  name: true,
                  service: {
                    select: {
                      id: true,
                      name: true,
                      category: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.payment.findMany({
        where: {
          status: { in: ['SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED'] },
          OR: [{ paidAt: { gte: from, lte: to } }, { paidAt: null, createdAt: { gte: from, lte: to } }],
          ...(query.serviceId || query.categoryId ? { order: { ...serviceFilter, ...categoryFilter } } : {}),
        },
        select: {
          id: true,
          amount: true,
          paidAt: true,
          createdAt: true,
          orderId: true,
          refunds: {
            where: { status: { not: 'FAILED' } },
            select: { amount: true },
          },
        },
      }),
    ]);

    // Totals
    let totalRevenue = 0;
    let refundTotal = 0;
    const paymentNetByOrder = new Map<string, number>();

    for (const p of payments) {
      const refundsSum = p.refunds.reduce((sum, r) => sum + r.amount, 0);
      refundTotal += refundsSum;
      const net = Math.max(0, p.amount - refundsSum);
      totalRevenue += net;
      if (p.orderId) {
        paymentNetByOrder.set(p.orderId, (paymentNetByOrder.get(p.orderId) ?? 0) + net);
      }
    }

    const discountTotal = orders.reduce((sum, o) => sum + (o.discount ?? 0), 0);

    // Monthly breakdown
    const monthlyMap = new Map<string, { revenue: number; orders: number }>();

    for (const p of payments) {
      const d = p.paidAt ?? p.createdAt;
      const ym = istDay(d).slice(0, 7); // YYYY-MM
      const cur = monthlyMap.get(ym) ?? { revenue: 0, orders: 0 };
      const ref = p.refunds.reduce((s, r) => s + r.amount, 0);
      cur.revenue += Math.max(0, p.amount - ref);
      monthlyMap.set(ym, cur);
    }
    for (const o of orders) {
      const ym = istDay(o.createdAt).slice(0, 7);
      const cur = monthlyMap.get(ym) ?? { revenue: 0, orders: 0 };
      cur.orders += 1;
      monthlyMap.set(ym, cur);
    }

    const monthly = Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, stats]) => {
        const [yearStr, monthStr] = month.split('-');
        const monthIndex = Number(monthStr) - 1;
        const label = `${MONTH_NAMES[monthIndex]} ${yearStr}`;
        return {
          month,
          label,
          revenue: stats.revenue,
          orders: stats.orders,
        };
      });

    // Service-wise and Category-wise aggregation
    const serviceMap = new Map<string, { serviceName: string; categoryName: string; orders: Set<string>; revenue: number }>();
    const categoryMap = new Map<string, { categoryName: string; orders: Set<string>; revenue: number }>();

    for (const o of orders) {
      const orderRevenue = paymentNetByOrder.get(o.id) ?? (o.total - (o.discount ?? 0));
      for (const item of o.items) {
        const svc = item.package.service;
        const cat = svc.category;

        // Service map
        const curSvc = serviceMap.get(svc.id) ?? {
          serviceName: svc.name,
          categoryName: cat.name,
          orders: new Set(),
          revenue: 0,
        };
        curSvc.orders.add(o.id);
        curSvc.revenue += orderRevenue; // allocate revenue to the service
        serviceMap.set(svc.id, curSvc);

        // Category map
        const curCat = categoryMap.get(cat.id) ?? {
          categoryName: cat.name,
          orders: new Set(),
          revenue: 0,
        };
        curCat.orders.add(o.id);
        curCat.revenue += orderRevenue;
        categoryMap.set(cat.id, curCat);
      }
    }

    const serviceWise = Array.from(serviceMap.entries()).map(([serviceId, data]) => ({
      serviceId,
      serviceName: data.serviceName,
      categoryName: data.categoryName,
      orders: data.orders.size,
      revenue: data.revenue,
    }));

    const categoryWise = Array.from(categoryMap.entries()).map(([categoryId, data]) => ({
      categoryId,
      categoryName: data.categoryName,
      orders: data.orders.size,
      revenue: data.revenue,
    }));

    // Coupon impact
    let couponDiscountGiven = 0;
    let ordersWithCouponCount = 0;
    const couponBreakdown = new Map<string, { type: string; ordersCount: number; discountGiven: number }>();

    for (const o of orders) {
      if (o.couponId && o.coupon) {
        ordersWithCouponCount += 1;
        const disc = o.discount ?? 0;
        couponDiscountGiven += disc;

        const cur = couponBreakdown.get(o.coupon.code) ?? {
          type: o.coupon.type,
          ordersCount: 0,
          discountGiven: 0,
        };
        cur.ordersCount += 1;
        cur.discountGiven += disc;
        couponBreakdown.set(o.coupon.code, cur);
      }
    }

    const coupons = Array.from(couponBreakdown.entries()).map(([code, data]) => ({
      code,
      type: data.type,
      ordersCount: data.ordersCount,
      discountGiven: data.discountGiven,
    }));

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      total: {
        revenue: totalRevenue,
        orders: orders.length,
        discountTotal,
        refundTotal,
      },
      monthly,
      serviceWise,
      categoryWise,
      couponImpact: {
        discountGiven: couponDiscountGiven,
        ordersWithCoupon: ordersWithCouponCount,
        coupons,
      },
    };
  }

  /**
   * Builds the Customers report: total, new in range, active in last 90 days.
   */
  async getCustomersReport(query: ReportDateRangeQuery, now = new Date()): Promise<ReportCustomersResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const activeAppCustomers = await this.prisma.application.findMany({
      where: { updatedAt: { gte: ninetyDaysAgo } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    const activeCustomerIds = activeAppCustomers.map((a) => a.customerId);

    const [total, newInRange, activeLast90Days] = await Promise.all([
      // Total customers on the platform
      this.prisma.user.count({
        where: {
          roles: { some: { role: { key: 'CUSTOMER' } } },
        },
      }),
      // New customers registered in the date range
      this.prisma.user.count({
        where: {
          roles: { some: { role: { key: 'CUSTOMER' } } },
          createdAt: { gte: from, lte: to },
        },
      }),
      // Active in last 90 days: has placed an order or updated an application in the last 90 days
      this.prisma.user.count({
        where: {
          roles: { some: { role: { key: 'CUSTOMER' } } },
          OR: [
            { orders: { some: { createdAt: { gte: ninetyDaysAgo } } } },
            ...(activeCustomerIds.length > 0 ? [{ id: { in: activeCustomerIds } }] : []),
          ],
        },
      }),
    ]);

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      total,
      newInRange,
      activeLast90Days,
    };
  }
}
