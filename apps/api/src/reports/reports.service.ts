import { Injectable } from '@nestjs/common';
import {
  type ReportConsultantsResponse,
  type ReportCustomersResponse,
  type ReportDashboardResponse,
  type ReportDateRangeQuery,
  type ReportSalesResponse,
  type ReportServicesResponse,
  type ReportSupportResponse,
  getDaysInISTRange,
  istDay,
  resolveReportDateRange,
} from '@biznexa/types';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PAYMENT_PENDING: 'Payment Pending',
  SUBMITTED: 'Submitted',
  DOCUMENTS_UNDER_REVIEW: 'Docs Under Review',
  DOCUMENTS_PENDING: 'Docs Pending',
  DOCUMENTS_APPROVED: 'Docs Approved',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

const VERIFICATION_LABELS: Record<string, string> = {
  PENDING: 'Pending Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
};

const TICKET_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_FOR_CUSTOMER: 'Waiting for Customer',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

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

  /**
   * Builds the Services report (M10.5): popular services (orders + revenue),
   * applications by status, average turnaround (submittedAt -> completedAt, days),
   * SLA breaches per service. All sums and aggregations computed directly in SQL.
   */
  async getServicesReport(query: ReportDateRangeQuery, now = new Date()): Promise<ReportServicesResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);

    // 1. Popular services (orders + revenue computed in SQL)
    const popularPromise = this.prisma.$queryRaw<
      Array<{
        serviceId: string;
        serviceName: string;
        categoryName: string;
        orders: number;
        revenue: bigint | number;
      }>
    >`
      SELECT
        s.id AS "serviceId",
        s.name AS "serviceName",
        c.name AS "categoryName",
        COUNT(DISTINCT o.id)::int AS "orders",
        COALESCE(SUM(
          COALESCE(op.net_amount, o.total - COALESCE(o.discount, 0))
        ), 0)::bigint AS "revenue"
      FROM "Service" s
      JOIN "Category" c ON c.id = s."categoryId"
      JOIN (
        SELECT DISTINCT sp."serviceId", oi."orderId"
        FROM "OrderItem" oi
        JOIN "ServicePackage" sp ON sp.id = oi."packageId"
      ) os ON os."serviceId" = s.id
      JOIN "Order" o ON o.id = os."orderId"
      LEFT JOIN (
        SELECT
          p."orderId",
          SUM(p.amount - COALESCE(rf.refund_sum, 0)) AS net_amount
        FROM "Payment" p
        LEFT JOIN (
          SELECT "paymentId", SUM(amount) AS refund_sum
          FROM "Refund"
          WHERE status != 'FAILED'
          GROUP BY "paymentId"
        ) rf ON rf."paymentId" = p.id
        WHERE p.status IN ('SUCCESS', 'REFUND_INITIATED', 'REFUNDED', 'PARTIALLY_REFUNDED')
        GROUP BY p."orderId"
      ) op ON op."orderId" = o.id
      WHERE o."createdAt" >= ${from} AND o."createdAt" <= ${to}
        ${query.serviceId ? Prisma.sql`AND s.id = ${query.serviceId}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND c.id = ${query.categoryId}` : Prisma.empty}
      GROUP BY s.id, s.name, c.name
      ORDER BY "revenue" DESC, "orders" DESC
    `;

    // 2. Average turnaround per service (submittedAt -> completedAt in days)
    const turnaroundByServicePromise = this.prisma.$queryRaw<
      Array<{
        serviceId: string;
        avgTurnaroundDays: number | null;
      }>
    >`
      SELECT
        a."serviceId",
        ROUND(AVG(EXTRACT(EPOCH FROM (a."completedAt" - a."submittedAt")) / 86400.0)::numeric, 1)::float AS "avgTurnaroundDays"
      FROM "Application" a
      JOIN "Service" s ON s.id = a."serviceId"
      WHERE a."submittedAt" IS NOT NULL
        AND a."completedAt" IS NOT NULL
        AND (
          (a."completedAt" >= ${from} AND a."completedAt" <= ${to})
          OR (a."createdAt" >= ${from} AND a."createdAt" <= ${to})
        )
        ${query.serviceId ? Prisma.sql`AND a."serviceId" = ${query.serviceId}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND s."categoryId" = ${query.categoryId}` : Prisma.empty}
      GROUP BY a."serviceId"
    `;

    // 3. Overall average turnaround
    const overallTurnaroundPromise = this.prisma.$queryRaw<
      Array<{ avgTurnaroundDays: number | null }>
    >`
      SELECT
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (a."completedAt" - a."submittedAt")) / 86400.0)::numeric, 1), 0)::float AS "avgTurnaroundDays"
      FROM "Application" a
      JOIN "Service" s ON s.id = a."serviceId"
      WHERE a."submittedAt" IS NOT NULL
        AND a."completedAt" IS NOT NULL
        AND (
          (a."completedAt" >= ${from} AND a."completedAt" <= ${to})
          OR (a."createdAt" >= ${from} AND a."createdAt" <= ${to})
        )
        ${query.serviceId ? Prisma.sql`AND a."serviceId" = ${query.serviceId}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND s."categoryId" = ${query.categoryId}` : Prisma.empty}
    `;

    // 4. SLA breaches per service (active open overdue applications)
    const breachesPromise = this.prisma.$queryRaw<
      Array<{
        serviceId: string;
        serviceName: string;
        categoryName: string;
        breachCount: number;
      }>
    >`
      SELECT
        s.id AS "serviceId",
        s.name AS "serviceName",
        c.name AS "categoryName",
        COUNT(a.id)::int AS "breachCount"
      FROM "Application" a
      JOIN "Service" s ON s.id = a."serviceId"
      JOIN "Category" c ON c.id = s."categoryId"
      WHERE a.status NOT IN ('DRAFT', 'COMPLETED', 'DELIVERED', 'CANCELLED')
        AND a."slaDueAt" IS NOT NULL
        AND a."slaDueAt" < ${now}
        ${query.serviceId ? Prisma.sql`AND s.id = ${query.serviceId}` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND c.id = ${query.categoryId}` : Prisma.empty}
      GROUP BY s.id, s.name, c.name
      ORDER BY "breachCount" DESC
    `;

    // 5. Applications grouped by status (SQL groupBy)
    const statusCountsPromise = this.prisma.application.groupBy({
      by: ['status'],
      where: {
        createdAt: { gte: from, lte: to },
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.categoryId ? { service: { categoryId: query.categoryId } } : {}),
      },
      _count: { _all: true },
    });

    const [popularRows, turnaroundRows, overallTurnaround, breachRows, statusCounts] = await Promise.all([
      popularPromise,
      turnaroundByServicePromise,
      overallTurnaroundPromise,
      breachesPromise,
      statusCountsPromise,
    ]);

    const turnaroundMap = new Map<string, number>(
      turnaroundRows
        .filter((r) => r.avgTurnaroundDays !== null)
        .map((r) => [r.serviceId, Number(r.avgTurnaroundDays)]),
    );

    const breachMap = new Map<string, number>(
      breachRows.map((r) => [r.serviceId, Number(r.breachCount)]),
    );

    const popularServices = popularRows.map((r) => ({
      serviceId: r.serviceId,
      serviceName: r.serviceName,
      categoryName: r.categoryName,
      orders: Number(r.orders),
      revenue: Number(r.revenue),
      avgTurnaroundDays: turnaroundMap.get(r.serviceId) ?? null,
      slaBreaches: breachMap.get(r.serviceId) ?? 0,
    }));

    const applicationsByStatus = statusCounts
      .map((sc) => ({
        status: sc.status,
        label: STATUS_LABELS[sc.status] ?? sc.status,
        count: sc._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const totalOrders = popularServices.reduce((sum, s) => sum + s.orders, 0);
    const totalRevenue = popularServices.reduce((sum, s) => sum + s.revenue, 0);
    const totalSlaBreaches = breachRows.reduce((sum, b) => sum + Number(b.breachCount), 0);
    const avgTurnaroundDays = Number(overallTurnaround[0]?.avgTurnaroundDays ?? 0);

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      summary: {
        totalOrders,
        totalRevenue,
        avgTurnaroundDays,
        totalSlaBreaches,
      },
      popularServices,
      applicationsByStatus,
      slaBreaches: breachRows.map((b) => ({
        serviceId: b.serviceId,
        serviceName: b.serviceName,
        categoryName: b.categoryName,
        breachCount: Number(b.breachCount),
      })),
    };
  }

  /**
   * Builds the Consultants report (M10.6): total, by verification status,
   * active, bookings count and booking revenue (Booking + its SUCCESS payments),
   * average rating. All sums and metrics computed in SQL.
   */
  async getConsultantsReport(query: ReportDateRangeQuery, now = new Date()): Promise<ReportConsultantsResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);

    const [total, active, statusCounts, avgRatingRows, consultantRows] = await Promise.all([
      // 1. Total consultants
      this.prisma.consultant.count(),

      // 2. Active approved consultants with active user account
      this.prisma.consultant.count({
        where: {
          verificationStatus: 'APPROVED',
          user: { status: 'ACTIVE' },
        },
      }),

      // 3. By verification status (SQL groupBy)
      this.prisma.consultant.groupBy({
        by: ['verificationStatus'],
        _count: { _all: true },
      }),

      // 4. Overall average rating of approved consultants (computed in SQL)
      this.prisma.$queryRaw<Array<{ avgRating: number | null }>>`
        SELECT
          COALESCE(ROUND(AVG(NULLIF(rating, 0))::numeric, 1), 0)::float AS "avgRating"
        FROM "Consultant"
        WHERE "verificationStatus" = 'APPROVED'
      `,

      // 5. Individual consultants breakdown: bookings count and booking revenue (Booking + SUCCESS payments) in range
      this.prisma.$queryRaw<
        Array<{
          consultantId: string;
          name: string;
          slug: string;
          category: string;
          verificationStatus: string;
          rating: number;
          reviewCount: number;
          bookingsCount: number;
          bookingRevenue: bigint | number;
        }>
      >`
        SELECT
          c.id AS "consultantId",
          u.name AS "name",
          c.slug AS "slug",
          c.category::text AS "category",
          c."verificationStatus"::text AS "verificationStatus",
          c.rating::float AS "rating",
          c."reviewCount"::int AS "reviewCount",
          COUNT(DISTINCT b.id)::int AS "bookingsCount",
          COALESCE(SUM(p.amount), 0)::bigint AS "bookingRevenue"
        FROM "Consultant" c
        JOIN "User" u ON u.id = c."userId"
        LEFT JOIN "Booking" b ON b."consultantId" = c.id
          AND b."createdAt" >= ${from} AND b."createdAt" <= ${to}
        LEFT JOIN "Payment" p ON p."bookingId" = b.id AND p.status = 'SUCCESS'
        GROUP BY c.id, u.name, c.slug, c.category, c."verificationStatus", c.rating, c."reviewCount"
        ORDER BY "bookingRevenue" DESC, "bookingsCount" DESC, c.rating DESC
      `,
    ]);

    const byVerificationStatus = statusCounts
      .map((sc) => ({
        status: sc.verificationStatus,
        label: VERIFICATION_LABELS[sc.verificationStatus] ?? sc.verificationStatus,
        count: sc._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const consultants = consultantRows.map((r) => ({
      consultantId: r.consultantId,
      name: r.name,
      slug: r.slug,
      category: r.category,
      verificationStatus: r.verificationStatus,
      rating: Number(r.rating),
      reviewCount: Number(r.reviewCount),
      bookingsCount: Number(r.bookingsCount),
      bookingRevenue: Number(r.bookingRevenue),
    }));

    const bookingsCount = consultants.reduce((sum, c) => sum + c.bookingsCount, 0);
    const bookingRevenue = consultants.reduce((sum, c) => sum + c.bookingRevenue, 0);
    const averageRating = Number(avgRatingRows[0]?.avgRating ?? 0);

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      summary: {
        total,
        active,
        bookingsCount,
        bookingRevenue,
        averageRating,
      },
      byVerificationStatus,
      consultants,
    };
  }

  /**
   * Builds the Support report (M10.7): tickets by status,
   * average first staff response time, average resolution time.
   * All sums and metrics computed in SQL.
   */
  async getSupportReport(query: ReportDateRangeQuery, now = new Date()): Promise<ReportSupportResponse> {
    const { from, to, preset } = resolveReportDateRange(query, now);

    const [statusCounts, avgTimesRows, ticketRows] = await Promise.all([
      // 1. Tickets grouped by status in range (SQL groupBy)
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: {
          createdAt: { gte: from, lte: to },
        },
        _count: { _all: true },
      }),

      // 2. Average first staff response time & average resolution time in hours (computed in SQL)
      this.prisma.$queryRaw<
        Array<{
          avgFirstResponseHours: number | null;
          avgResolutionHours: number | null;
          totalTickets: number;
        }>
      >`
        SELECT
          COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 3600.0)::numeric, 1), 0)::float AS "avgFirstResponseHours",
          COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600.0)::numeric, 1), 0)::float AS "avgResolutionHours",
          COUNT(*)::int AS "totalTickets"
        FROM "Ticket"
        WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      `,

      // 3. Recent tickets in range with response and resolution times
      this.prisma.ticket.findMany({
        where: {
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: {
          customer: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
    ]);

    const byStatus = statusCounts
      .map((sc) => ({
        status: sc.status,
        label: TICKET_STATUS_LABELS[sc.status] ?? sc.status,
        count: sc._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const openCount = statusCounts
      .filter((sc) => sc.status === 'OPEN' || sc.status === 'IN_PROGRESS' || sc.status === 'WAITING_FOR_CUSTOMER')
      .reduce((sum, sc) => sum + sc._count._all, 0);

    const resolvedCount = statusCounts
      .filter((sc) => sc.status === 'RESOLVED' || sc.status === 'CLOSED')
      .reduce((sum, sc) => sum + sc._count._all, 0);

    const avgMetrics = avgTimesRows[0];
    const totalTickets = Number(avgMetrics?.totalTickets ?? 0);
    const avgFirstResponseHours = Number(avgMetrics?.avgFirstResponseHours ?? 0);
    const avgResolutionHours = Number(avgMetrics?.avgResolutionHours ?? 0);

    const recentTickets = ticketRows.map((t) => {
      const firstResponseHours = t.firstResponseAt
        ? Number(((t.firstResponseAt.getTime() - t.createdAt.getTime()) / (3600 * 1000)).toFixed(1))
        : null;
      const resolutionHours = t.resolvedAt
        ? Number(((t.resolvedAt.getTime() - t.createdAt.getTime()) / (3600 * 1000)).toFixed(1))
        : null;

      return {
        id: t.id,
        code: t.code,
        subject: t.subject,
        status: t.status,
        priority: t.priority,
        customerName: t.customer?.name ?? 'Unknown Customer',
        assignedToName: t.assignedTo?.name ?? null,
        createdAt: t.createdAt.toISOString(),
        firstResponseAt: t.firstResponseAt ? t.firstResponseAt.toISOString() : null,
        resolvedAt: t.resolvedAt ? t.resolvedAt.toISOString() : null,
        firstResponseHours,
        resolutionHours,
      };
    });

    return {
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
        preset,
      },
      summary: {
        totalTickets,
        openTickets: openCount,
        resolvedTickets: resolvedCount,
        avgFirstResponseHours,
        avgResolutionHours,
      },
      byStatus,
      recentTickets,
    };
  }
}


