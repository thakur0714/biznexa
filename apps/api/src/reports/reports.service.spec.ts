import { ReportsService } from './reports.service';

describe('ReportsService (Unit with fixed fixtures)', () => {
  let service: ReportsService;
  let mockPrisma: any;

  // Fixed timestamps:
  // Payment 1 at 23:59 IST on 2026-10-17 = 2026-10-17T18:29:00.000Z
  const p1Time = new Date('2026-10-17T23:59:00.000+05:30');
  // Payment 2 at 00:01 IST on 2026-10-18 = 2026-10-17T18:31:00.000Z
  const p2Time = new Date('2026-10-18T00:01:00.000+05:30');
  // Order 1 at 20:00 IST on 2026-10-17
  const o1Time = new Date('2026-10-17T20:00:00.000+05:30');
  // Order 2 at 10:00 IST on 2026-10-18
  const o2Time = new Date('2026-10-18T10:00:00.000+05:30');

  const fixedPayments = [
    {
      id: 'pay-1',
      amount: 100000,
      paidAt: p1Time,
      createdAt: p1Time,
      orderId: 'ord-1',
      refunds: [],
    },
    {
      id: 'pay-2',
      amount: 200000,
      paidAt: p2Time,
      createdAt: p2Time,
      orderId: 'ord-2',
      refunds: [{ amount: 50000, status: 'PROCESSED' }],
    },
  ];

  const fixedOrders = [
    {
      id: 'ord-1',
      total: 100000,
      discount: 10000,
      couponId: 'coup-1',
      createdAt: o1Time,
      coupon: { code: 'SAVE10', type: 'FIXED' },
      items: [
        {
          professionalFee: 90000,
          governmentFee: 10000,
          discount: 10000,
          package: {
            id: 'pkg-1',
            name: 'Basic',
            service: {
              id: 'svc-1',
              name: 'Private Limited',
              category: { id: 'cat-1', name: 'Start' },
            },
          },
        },
      ],
    },
    {
      id: 'ord-2',
      total: 200000,
      discount: 0,
      couponId: null,
      createdAt: o2Time,
      coupon: null,
      items: [
        {
          professionalFee: 180000,
          governmentFee: 20000,
          discount: 0,
          package: {
            id: 'pkg-2',
            name: 'Standard',
            service: {
              id: 'svc-2',
              name: 'GST Filing',
              category: { id: 'cat-2', name: 'Comply' },
            },
          },
        },
      ],
    },
  ];

  beforeEach(() => {
    mockPrisma = {
      payment: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          const from = where.OR?.[0]?.paidAt?.gte;
          const to = where.OR?.[0]?.paidAt?.lte;
          return fixedPayments.filter((p) => {
            const t = (p.paidAt ?? p.createdAt).getTime();
            if (from && t < from.getTime()) return false;
            if (to && t > to.getTime()) return false;
            return true;
          });
        }),
      },
      order: {
        findMany: jest.fn().mockImplementation(async ({ where }) => {
          const from = where.createdAt?.gte;
          const to = where.createdAt?.lte;
          return fixedOrders.filter((o) => {
            const t = o.createdAt.getTime();
            if (from && t < from.getTime()) return false;
            if (to && t > to.getTime()) return false;
            return true;
          });
        }),
      },
      user: {
        count: jest.fn().mockResolvedValue(42),
        findMany: jest.fn().mockResolvedValue([{ id: 'cust-1', name: 'Alice Smith' }]),
      },
      application: {
        count: jest.fn().mockResolvedValue(5),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'app-1',
            code: 'BN1001',
            status: 'IN_PROGRESS',
            slaDueAt: new Date('2026-10-16T12:00:00Z'),
            customerId: 'cust-1',
            service: { name: 'Private Limited' },
          },
        ]),
      },
      applicationDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'doc-1',
            name: 'PAN Card',
            uploadedAt: new Date('2026-10-15T10:00:00Z'),
            createdAt: new Date('2026-10-15T10:00:00Z'),
            application: {
              id: 'app-1',
              code: 'BN1001',
              service: { name: 'Private Limited' },
            },
          },
        ]),
      },
      $queryRaw: jest.fn().mockImplementation(async (query: any) => {
        const sql = Array.isArray(query?.strings) ? query.strings.join(' ') : String(query);
        if (sql.includes('COUNT(DISTINCT o.id)')) {
          return [
            {
              serviceId: 'svc-1',
              serviceName: 'Private Limited',
              categoryName: 'Start',
              orders: 1,
              revenue: 100000n,
            },
          ];
        }
        if (sql.includes('avgTurnaroundDays') && sql.includes('GROUP BY a."serviceId"')) {
          return [
            {
              serviceId: 'svc-1',
              avgTurnaroundDays: 2.5,
            },
          ];
        }
        if (sql.includes('avgTurnaroundDays')) {
          return [{ avgTurnaroundDays: 2.5 }];
        }
        if (sql.includes('breachCount')) {
          return [
            {
              serviceId: 'svc-1',
              serviceName: 'Private Limited',
              categoryName: 'Start',
              breachCount: 1,
            },
          ];
        }
        if (sql.includes('AVG(NULLIF(rating, 0))')) {
          return [{ avgRating: 4.8 }];
        }
        if (sql.includes('c."consultantId"') || sql.includes('c.id AS "consultantId"')) {
          return [
            {
              consultantId: 'c-1',
              name: 'Priya Sharma',
              slug: 'priya-sharma',
              category: 'CA',
              verificationStatus: 'APPROVED',
              rating: 4.9,
              reviewCount: 15,
              bookingsCount: 20,
              bookingRevenue: 10000000n,
            },
          ];
        }
        if (sql.includes('avgFirstResponseHours')) {
          return [
            {
              avgFirstResponseHours: 1.5,
              avgResolutionHours: 12.0,
              totalTickets: 4,
            },
          ];
        }
        return [];
      }),
      consultant: {
        count: jest.fn().mockImplementation(async (args?: any) => {
          if (args?.where?.verificationStatus === 'APPROVED') return 8;
          return 10;
        }),
        groupBy: jest.fn().mockResolvedValue([
          { verificationStatus: 'APPROVED', _count: { _all: 8 } },
          { verificationStatus: 'PENDING', _count: { _all: 2 } },
        ]),
      },
      ticket: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'RESOLVED', _count: { _all: 3 } },
          { status: 'OPEN', _count: { _all: 1 } },
        ]),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 't-1',
            code: 'TICK-1',
            subject: 'Issue with payment',
            status: 'RESOLVED',
            priority: 'HIGH',
            customer: { id: 'cust-1', name: 'John Doe' },
            assignedTo: { id: 'staff-1', name: 'Support Staff' },
            createdAt: new Date('2026-10-15T10:00:00.000Z'),
            firstResponseAt: new Date('2026-10-15T11:30:00.000Z'),
            resolvedAt: new Date('2026-10-15T22:00:00.000Z'),
          },
        ]),
      },
    };
    mockPrisma.application.groupBy = jest.fn().mockResolvedValue([
      { status: 'COMPLETED', _count: { _all: 3 } },
      { status: 'IN_PROGRESS', _count: { _all: 1 } },
    ]);

    service = new ReportsService(mockPrisma);
  });



  describe('IST Boundary Handling in Dashboard KPIs', () => {
    it('Day 17 range includes payment at 23:59 IST and excludes payment at 00:01 IST next day', async () => {
      const res = await service.getDashboard({
        from: '2026-10-17',
        to: '2026-10-17',
      });

      // Exactly payment 1 (100,000 paise)
      expect(res.kpis.revenue).toBe(100000);
      expect(res.kpis.orders).toBe(1);
      expect(res.series).toHaveLength(1);
      expect(res.series[0]).toEqual({
        date: '2026-10-17',
        revenue: 100000,
        orders: 1,
      });
      expect(res.needsAttention.slaBreaches).toHaveLength(1);
      expect(res.needsAttention.slaBreaches[0].customerName).toBe('Alice Smith');
      expect(res.needsAttention.waitingDocuments).toHaveLength(1);
    });

    it('Day 18 range includes payment at 00:01 IST (with refund reduction) and excludes Day 17 payment', async () => {
      const res = await service.getDashboard({
        from: '2026-10-18',
        to: '2026-10-18',
      });

      // Payment 2 (200,000 - 50,000 refund = 150,000 paise)
      expect(res.kpis.revenue).toBe(150000);
      expect(res.kpis.orders).toBe(1);
      expect(res.series).toHaveLength(1);
      expect(res.series[0]).toEqual({
        date: '2026-10-18',
        revenue: 150000,
        orders: 1,
      });
    });

    it('Multi-day range spanning 17 to 18 accumulates both with exact numbers', async () => {
      const res = await service.getDashboard({
        from: '2026-10-17',
        to: '2026-10-18',
      });

      expect(res.kpis.revenue).toBe(250000); // 100,000 + 150,000
      expect(res.kpis.orders).toBe(2);
      expect(res.series).toEqual([
        { date: '2026-10-17', revenue: 100000, orders: 1 },
        { date: '2026-10-18', revenue: 150000, orders: 1 },
      ]);
    });
  });

  describe('Sales Report aggregations', () => {
    it('calculates total, monthly, service-wise, category-wise and coupon impact', async () => {
      const res = await service.getSalesReport({
        from: '2026-10-17',
        to: '2026-10-18',
      });

      expect(res.total.revenue).toBe(250000);
      expect(res.total.orders).toBe(2);
      expect(res.total.discountTotal).toBe(10000);
      expect(res.total.refundTotal).toBe(50000);

      // Monthly
      expect(res.monthly).toHaveLength(1);
      expect(res.monthly[0]).toEqual({
        month: '2026-10',
        label: 'Oct 2026',
        revenue: 250000,
        orders: 2,
      });

      // Service-wise
      expect(res.serviceWise).toHaveLength(2);
      const svc1 = res.serviceWise.find((s) => s.serviceId === 'svc-1');
      expect(svc1).toEqual({
        serviceId: 'svc-1',
        serviceName: 'Private Limited',
        categoryName: 'Start',
        orders: 1,
        revenue: 100000,
      });

      // Category-wise
      expect(res.categoryWise).toHaveLength(2);
      const cat1 = res.categoryWise.find((c) => c.categoryId === 'cat-1');
      expect(cat1).toEqual({
        categoryId: 'cat-1',
        categoryName: 'Start',
        orders: 1,
        revenue: 100000,
      });

      // Coupon impact
      expect(res.couponImpact.discountGiven).toBe(10000);
      expect(res.couponImpact.ordersWithCoupon).toBe(1);
      expect(res.couponImpact.coupons).toEqual([
        {
          code: 'SAVE10',
          type: 'FIXED',
          ordersCount: 1,
          discountGiven: 10000,
        },
      ]);
    });
  });

  describe('Customers Report aggregations', () => {
    it('returns total, newInRange, activeLast90Days', async () => {
      const res = await service.getCustomersReport({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(res.total).toBe(42);
      expect(res.newInRange).toBe(42);
      expect(res.activeLast90Days).toBe(42);
    });
  });

  describe('Services Report aggregations (M10.5)', () => {
    it('returns popular services, turnaround, applications by status, and SLA breaches', async () => {
      const res = await service.getServicesReport({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(res.range).toBeDefined();
      expect(res.summary.totalOrders).toBe(1);
      expect(res.summary.totalRevenue).toBe(100000);
      expect(res.summary.avgTurnaroundDays).toBe(2.5);
      expect(res.summary.totalSlaBreaches).toBe(1);

      expect(res.popularServices).toEqual([
        {
          serviceId: 'svc-1',
          serviceName: 'Private Limited',
          categoryName: 'Start',
          orders: 1,
          revenue: 100000,
          avgTurnaroundDays: 2.5,
          slaBreaches: 1,
        },
      ]);

      expect(res.applicationsByStatus).toEqual([
        { status: 'COMPLETED', label: 'Completed', count: 3 },
        { status: 'IN_PROGRESS', label: 'In Progress', count: 1 },
      ]);

      expect(res.slaBreaches).toEqual([
        {
          serviceId: 'svc-1',
          serviceName: 'Private Limited',
          categoryName: 'Start',
          breachCount: 1,
        },
      ]);
    });
  });

  describe('Consultants Report aggregations (M10.6)', () => {
    it('returns total, active, by verification status, bookings count, revenue, and average rating', async () => {
      const res = await service.getConsultantsReport({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(res.range).toBeDefined();
      expect(res.summary.total).toBe(10);
      expect(res.summary.active).toBe(8);
      expect(res.summary.bookingsCount).toBe(20);
      expect(res.summary.bookingRevenue).toBe(10000000);
      expect(res.summary.averageRating).toBe(4.8);

      expect(res.byVerificationStatus).toEqual([
        { status: 'APPROVED', label: 'Approved', count: 8 },
        { status: 'PENDING', label: 'Pending Review', count: 2 },
      ]);

      expect(res.consultants).toHaveLength(1);
      expect(res.consultants[0]).toEqual({
        consultantId: 'c-1',
        name: 'Priya Sharma',
        slug: 'priya-sharma',
        category: 'CA',
        verificationStatus: 'APPROVED',
        rating: 4.9,
        reviewCount: 15,
        bookingsCount: 20,
        bookingRevenue: 10000000,
      });
    });
  });

  describe('Support Report aggregations (M10.7)', () => {
    it('returns tickets by status, avg first response time, avg resolution time, and recent tickets', async () => {
      const res = await service.getSupportReport({
        from: '2026-10-01',
        to: '2026-10-31',
      });

      expect(res.range).toBeDefined();
      expect(res.summary.totalTickets).toBe(4);
      expect(res.summary.openTickets).toBe(1);
      expect(res.summary.resolvedTickets).toBe(3);
      expect(res.summary.avgFirstResponseHours).toBe(1.5);
      expect(res.summary.avgResolutionHours).toBe(12.0);

      expect(res.byStatus).toEqual([
        { status: 'RESOLVED', label: 'Resolved', count: 3 },
        { status: 'OPEN', label: 'Open', count: 1 },
      ]);

      expect(res.recentTickets).toHaveLength(1);
      expect(res.recentTickets[0]).toEqual({
        id: 't-1',
        code: 'TICK-1',
        subject: 'Issue with payment',
        status: 'RESOLVED',
        priority: 'HIGH',
        customerName: 'John Doe',
        assignedToName: 'Support Staff',
        createdAt: '2026-10-15T10:00:00.000Z',
        firstResponseAt: '2026-10-15T11:30:00.000Z',
        resolvedAt: '2026-10-15T22:00:00.000Z',
        firstResponseHours: 1.5,
        resolutionHours: 12.0,
      });
    });
  });

  describe('Report Export Lifecycle', () => {
    it('enqueues export and generates valid 24h download link', async () => {
      const mockStorage = {
        write: jest.fn().mockResolvedValue(undefined),
        read: jest.fn().mockImplementation(async (key: string) => ({
          stream: (async function* () {
            yield Buffer.from('--- SALES REPORT SUMMARY ---');
          })(),
          size: 28,
        })),
        remove: jest.fn(),
      };

      const exportService = new ReportsService(mockPrisma, undefined, mockStorage as any);
      const user = { id: 'admin-1', roles: ['ADMIN'], permissions: ['reports.view'], twoFactorPending: false };

      const job = await exportService.enqueueExport({ type: 'sales', preset: 'today' }, user.id);
      expect(job.id).toBeDefined();
      expect(job.type).toBe('sales');
      expect(job.status).toBe('PENDING');

      // Since no queue was provided, it processed synchronously into exportCache
      const link = await exportService.createExportLink(job.id, user);
      expect(link.url).toMatch(new RegExp(`^/api/admin/reports/export/${job.id}/download\\?`));

      const now = Date.now();
      const expiresAt = new Date(link.expiresAt).getTime();
      // Should be ~24 hours (86400 seconds) in the future
      expect(expiresAt - now).toBeGreaterThan(23 * 3600 * 1000);
      expect(expiresAt - now).toBeLessThanOrEqual(24 * 3600 * 1000 + 5000);

      // Verify opening the signed download
      const queryParams = Object.fromEntries(new URL(`http://localhost${link.url}`).searchParams);
      const streamRes = await exportService.openExportLinked(job.id, queryParams);
      expect(streamRes.size).toBe(28);
      expect(streamRes.disposition).toContain('attachment;');
    });

    it('throws 404 if export does not exist', async () => {
      const user = { id: 'admin-1', roles: ['ADMIN'], permissions: ['reports.view'], twoFactorPending: false };
      await expect(service.createExportLink('non-existent-id', user)).rejects.toThrow('Export not found');
    });
  });
});


