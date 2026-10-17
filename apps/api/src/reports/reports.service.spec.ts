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
    };

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
      expect(res.series.length).toBe(1);
      expect(res.series[0]).toEqual({
        date: '2026-10-17',
        revenue: 100000,
        orders: 1,
      });
      expect(res.needsAttention.slaBreaches.length).toBe(1);
      expect(res.needsAttention.slaBreaches[0].customerName).toBe('Alice Smith');
      expect(res.needsAttention.waitingDocuments.length).toBe(1);
    });

    it('Day 18 range includes payment at 00:01 IST (with refund reduction) and excludes Day 17 payment', async () => {
      const res = await service.getDashboard({
        from: '2026-10-18',
        to: '2026-10-18',
      });

      // Payment 2 (200,000 - 50,000 refund = 150,000 paise)
      expect(res.kpis.revenue).toBe(150000);
      expect(res.kpis.orders).toBe(1);
      expect(res.series.length).toBe(1);
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
      expect(res.monthly.length).toBe(1);
      expect(res.monthly[0]).toEqual({
        month: '2026-10',
        label: 'Oct 2026',
        revenue: 250000,
        orders: 2,
      });

      // Service-wise
      expect(res.serviceWise.length).toBe(2);
      const svc1 = res.serviceWise.find((s) => s.serviceId === 'svc-1');
      expect(svc1).toEqual({
        serviceId: 'svc-1',
        serviceName: 'Private Limited',
        categoryName: 'Start',
        orders: 1,
        revenue: 100000,
      });

      // Category-wise
      expect(res.categoryWise.length).toBe(2);
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
});
