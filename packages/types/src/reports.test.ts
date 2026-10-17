import { describe, expect, it } from 'vitest';
import {
  getDaysInISTRange,
  isWithinISTDay,
  istDayEnd,
  istDayStart,
  normalizeReportPreset,
  presetDateRange,
  resolveReportDateRange,
  reportExportRequestSchema,
  reportExportJobSchema,
} from './reports';

describe('Reports Date & IST Boundary Helpers', () => {
  it('normalizes presets with spaces and underscores', () => {
    expect(normalizeReportPreset('today')).toBe('today');
    expect(normalizeReportPreset('TODAY')).toBe('today');
    expect(normalizeReportPreset('last 7 days')).toBe('last 7 days');
    expect(normalizeReportPreset('last_7_days')).toBe('last 7 days');
    expect(normalizeReportPreset('this month')).toBe('this month');
    expect(normalizeReportPreset('this_month')).toBe('this month');
    expect(normalizeReportPreset('last month')).toBe('last month');
    expect(normalizeReportPreset('last_month')).toBe('last month');
    expect(normalizeReportPreset('invalid')).toBeNull();
    expect(normalizeReportPreset(null)).toBeNull();
  });

  it('istDayStart returns 00:00:00.000 in IST (+05:30) which is 18:30:00.000Z previous day', () => {
    const start = istDayStart('2026-10-17');
    expect(start.toISOString()).toBe('2026-10-16T18:30:00.000Z');
  });

  it('istDayEnd returns 23:59:59.999 in IST (+05:30) which is 18:29:59.999Z same day', () => {
    const end = istDayEnd('2026-10-17');
    expect(end.toISOString()).toBe('2026-10-17T18:29:59.999Z');
  });

  it('handles boundary cases: payment at 23:59 IST vs 00:01 IST next day', () => {
    const start17 = istDayStart('2026-10-17'); // 2026-10-16T18:30:00.000Z
    const end17 = istDayEnd('2026-10-17');     // 2026-10-17T18:29:59.999Z

    // Payment at 23:59 IST on 17-Oct-2026 = 18:29:00 UTC
    const payment2359 = new Date('2026-10-17T23:59:00.000+05:30');
    expect(payment2359.toISOString()).toBe('2026-10-17T18:29:00.000Z');
    expect(payment2359.getTime()).toBeGreaterThanOrEqual(start17.getTime());
    expect(payment2359.getTime()).toBeLessThanOrEqual(end17.getTime());
    expect(isWithinISTDay(payment2359, '2026-10-17')).toBe(true);
    expect(isWithinISTDay(payment2359, '2026-10-18')).toBe(false);

    // Payment at 00:01 IST on 18-Oct-2026 = 18:31:00 UTC on 17-Oct-2026
    const payment0001 = new Date('2026-10-18T00:01:00.000+05:30');
    expect(payment0001.toISOString()).toBe('2026-10-17T18:31:00.000Z');
    expect(payment0001.getTime()).toBeGreaterThan(end17.getTime());
    expect(isWithinISTDay(payment0001, '2026-10-17')).toBe(false);
    expect(isWithinISTDay(payment0001, '2026-10-18')).toBe(true);

    // Payment at 23:59 IST on 16-Oct-2026 = 18:29:00 UTC on 16-Oct-2026
    const paymentPrev2359 = new Date('2026-10-16T23:59:00.000+05:30');
    expect(paymentPrev2359.getTime()).toBeLessThan(start17.getTime());
    expect(isWithinISTDay(paymentPrev2359, '2026-10-17')).toBe(false);
  });

  describe('Presets calculation', () => {
    // Reference instant: 2026-10-17 14:00:00 IST
    const fixedNow = new Date('2026-10-17T14:00:00.000+05:30');

    it('today preset', () => {
      const range = presetDateRange('today', fixedNow);
      expect(range.from.toISOString()).toBe('2026-10-16T18:30:00.000Z');
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('last 7 days preset spans 7 consecutive IST days', () => {
      const range = presetDateRange('last 7 days', fixedNow);
      expect(range.from.toISOString()).toBe('2026-10-10T18:30:00.000Z'); // 2026-10-11 00:00 IST
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');   // 2026-10-17 23:59 IST
      const days = getDaysInISTRange(range.from, range.to);
      expect(days).toEqual([
        '2026-10-11',
        '2026-10-12',
        '2026-10-13',
        '2026-10-14',
        '2026-10-15',
        '2026-10-16',
        '2026-10-17',
      ]);
      expect(days).toHaveLength(7);
    });

    it('this month preset starts on 1st of month', () => {
      const range = presetDateRange('this month', fixedNow);
      expect(range.from.toISOString()).toBe('2026-09-30T18:30:00.000Z'); // 2026-10-01 00:00 IST
      expect(range.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('last month preset covers full previous month (September 2026: 30 days)', () => {
      const range = presetDateRange('last month', fixedNow);
      expect(range.from.toISOString()).toBe('2026-08-31T18:30:00.000Z'); // 2026-09-01 00:00 IST
      expect(range.to.toISOString()).toBe('2026-09-30T18:29:59.999Z');   // 2026-09-30 23:59 IST
    });

    it('last month across year boundary (January -> previous December: 31 days)', () => {
      const janNow = new Date('2026-01-15T12:00:00.000+05:30');
      const range = presetDateRange('last month', janNow);
      expect(range.from.toISOString()).toBe('2025-11-30T18:30:00.000Z'); // 2025-12-01 00:00 IST
      expect(range.to.toISOString()).toBe('2025-12-31T18:29:59.999Z');   // 2025-12-31 23:59 IST
    });
  });

  describe('resolveReportDateRange', () => {
    const fixedNow = new Date('2026-10-17T14:00:00.000+05:30');

    it('resolves explicit from and to', () => {
      const res = resolveReportDateRange({ from: '2026-10-01', to: '2026-10-05' }, fixedNow);
      expect(res.from.toISOString()).toBe('2026-09-30T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-05T18:29:59.999Z');
    });

    it('resolves preset parameter', () => {
      const res = resolveReportDateRange({ preset: 'last_7_days' }, fixedNow);
      expect(res.preset).toBe('last 7 days');
      expect(res.from.toISOString()).toBe('2026-10-10T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });

    it('defaults to last 7 days when nothing provided', () => {
      const res = resolveReportDateRange({}, fixedNow);
      expect(res.preset).toBe('last 7 days');
      expect(res.from.toISOString()).toBe('2026-10-10T18:30:00.000Z');
      expect(res.to.toISOString()).toBe('2026-10-17T18:29:59.999Z');
    });
  });

  describe('Services Report Schema', () => {
    it('validates a complete ReportServicesResponse object', async () => {
      const { reportServicesResponseSchema } = await import('./reports');
      const valid = {
        range: {
          from: '2026-10-10T18:30:00.000Z',
          to: '2026-10-17T18:29:59.999Z',
          preset: 'last 7 days',
        },
        summary: {
          totalOrders: 10,
          totalRevenue: 5000000,
          avgTurnaroundDays: 2.5,
          totalSlaBreaches: 1,
        },
        popularServices: [
          {
            serviceId: 'svc-1',
            serviceName: 'Private Limited',
            categoryName: 'Startup',
            orders: 10,
            revenue: 5000000,
            avgTurnaroundDays: 2.5,
            slaBreaches: 1,
          },
        ],
        applicationsByStatus: [
          {
            status: 'COMPLETED',
            label: 'Completed',
            count: 8,
          },
          {
            status: 'IN_PROGRESS',
            label: 'In Progress',
            count: 2,
          },
        ],
        slaBreaches: [
          {
            serviceId: 'svc-1',
            serviceName: 'Private Limited',
            categoryName: 'Startup',
            breachCount: 1,
          },
        ],
      };

      const parsed = reportServicesResponseSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Consultants Report Schema', () => {
    it('validates a complete ReportConsultantsResponse object', async () => {
      const { reportConsultantsResponseSchema } = await import('./reports');
      const valid = {
        range: {
          from: '2026-10-10T18:30:00.000Z',
          to: '2026-10-17T18:29:59.999Z',
          preset: 'last 7 days',
        },
        summary: {
          total: 10,
          active: 8,
          bookingsCount: 25,
          bookingRevenue: 12500000,
          averageRating: 4.8,
        },
        byVerificationStatus: [
          { status: 'APPROVED', label: 'Approved', count: 8 },
          { status: 'PENDING', label: 'Pending Review', count: 2 },
        ],
        consultants: [
          {
            consultantId: 'c-1',
            name: 'Priya Sharma',
            slug: 'priya-sharma',
            category: 'CA',
            verificationStatus: 'APPROVED',
            rating: 4.9,
            reviewCount: 15,
            bookingsCount: 20,
            bookingRevenue: 10000000,
          },
        ],
      };

      const parsed = reportConsultantsResponseSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });
  });

  describe('Support Report Schema', () => {
    it('validates a complete ReportSupportResponse object', async () => {
      const { reportSupportResponseSchema } = await import('./reports');
      const valid = {
        range: {
          from: '2026-10-10T18:30:00.000Z',
          to: '2026-10-17T18:29:59.999Z',
          preset: 'last 7 days',
        },
        summary: {
          totalTickets: 15,
          openTickets: 5,
          resolvedTickets: 10,
          avgFirstResponseHours: 1.5,
          avgResolutionHours: 12.0,
        },
        byStatus: [
          { status: 'OPEN', label: 'Open', count: 2 },
          { status: 'IN_PROGRESS', label: 'In Progress', count: 3 },
          { status: 'RESOLVED', label: 'Resolved', count: 8 },
          { status: 'CLOSED', label: 'Closed', count: 2 },
        ],
        recentTickets: [
          {
            id: 't-1',
            code: 'TICK-101',
            subject: 'Issue with GST application',
            status: 'RESOLVED',
            priority: 'HIGH',
            customerName: 'Rahul Verma',
            assignedToName: 'Support Agent 1',
            createdAt: '2026-10-12T10:00:00.000Z',
            firstResponseAt: '2026-10-12T11:30:00.000Z',
            resolvedAt: '2026-10-12T22:00:00.000Z',
            firstResponseHours: 1.5,
            resolutionHours: 12.0,
          },
        ],
      };

      const parsed = reportSupportResponseSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('validates reportExportRequestSchema and reportExportJobSchema', () => {
      const validReq = {
        type: 'sales',
        preset: 'today',
      };
      expect(reportExportRequestSchema.safeParse(validReq).success).toBe(true);

      const invalidReq = {
        type: 'unknown-type',
      };
      expect(reportExportRequestSchema.safeParse(invalidReq).success).toBe(false);

      const validJob = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        type: 'consultants',
        status: 'PENDING',
        createdAt: '2026-10-17T12:00:00.000Z',
      };
      expect(reportExportJobSchema.safeParse(validJob).success).toBe(true);
    });
  });
});


