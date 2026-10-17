import { z } from 'zod';
import { istDay } from './format';

export const REPORT_PRESETS = ['today', 'last 7 days', 'this month', 'last month'] as const;
export type ReportPreset = (typeof REPORT_PRESETS)[number];

const PRESET_MAP: Record<string, ReportPreset> = {
  today: 'today',
  'last 7 days': 'last 7 days',
  last_7_days: 'last 7 days',
  'this month': 'this month',
  this_month: 'this month',
  'last month': 'last month',
  last_month: 'last month',
};

/** Normalizes string preset to a standard ReportPreset or null */
export function normalizeReportPreset(value?: string | null): ReportPreset | null {
  if (!value) return null;
  return PRESET_MAP[value.toLowerCase().trim()] ?? null;
}

/** Given a date or YYYY-MM-DD string, returns Date at 00:00:00.000 in IST (+05:30) */
export function istDayStart(value: Date | string): Date {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istDay(value);
  return new Date(`${day}T00:00:00.000+05:30`);
}

/** Given a date or YYYY-MM-DD string, returns Date at 23:59:59.999 in IST (+05:30) */
export function istDayEnd(value: Date | string): Date {
  const day = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istDay(value);
  return new Date(`${day}T23:59:59.999+05:30`);
}

/** Calculates from and to dates for a preset based on a reference `now` in IST */
export function presetDateRange(preset: ReportPreset, now = new Date()): { from: Date; to: Date } {
  const todayStr = istDay(now);
  const [yearStr, monthStr] = todayStr.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr); // 1-12

  switch (preset) {
    case 'today':
      return {
        from: istDayStart(todayStr),
        to: istDayEnd(todayStr),
      };
    case 'last 7 days': {
      const todayStart = istDayStart(todayStr);
      // 6 full days prior + today = 7 days
      const from = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
      return {
        from: istDayStart(from),
        to: istDayEnd(todayStr),
      };
    }
    case 'this month': {
      const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
      return {
        from: istDayStart(firstDay),
        to: istDayEnd(todayStr),
      };
    }
    case 'last month': {
      const prevYear = m === 1 ? y - 1 : y;
      const prevMonth = m === 1 ? 12 : m - 1;
      const firstDay = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`;
      // Number of days in prev month: day 0 of month m in year y
      const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
      const lastDay = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(daysInPrevMonth).padStart(2, '0')}`;
      return {
        from: istDayStart(firstDay),
        to: istDayEnd(lastDay),
      };
    }
  }
}

export interface ResolveDateRangeInput {
  preset?: string | null;
  from?: string | Date | null;
  to?: string | Date | null;
  serviceId?: string | null;
  categoryId?: string | null;
}

/**
 * Resolves query params or preset into exact { from, to } Date boundaries in IST.
 * If neither preset nor from/to is provided, defaults to 'last 7 days'.
 */
export function resolveReportDateRange(
  input: ResolveDateRangeInput,
  now = new Date(),
): { from: Date; to: Date; preset?: ReportPreset } {
  const normalizedPreset = normalizeReportPreset(input.preset);

  if (input.from && input.to) {
    return {
      from: istDayStart(input.from),
      to: istDayEnd(input.to),
      preset: normalizedPreset ?? undefined,
    };
  }

  if (input.from) {
    return {
      from: istDayStart(input.from),
      to: istDayEnd(now),
      preset: normalizedPreset ?? undefined,
    };
  }

  if (normalizedPreset) {
    const range = presetDateRange(normalizedPreset, now);
    return { ...range, preset: normalizedPreset };
  }

  // Default to 'last 7 days'
  const def = presetDateRange('last 7 days', now);
  return { ...def, preset: 'last 7 days' };
}

/** Returns array of all YYYY-MM-DD IST calendar days from start to end */
export function getDaysInISTRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const startDay = istDay(from);
  const endDay = istDay(to);
  let cur = istDayStart(startDay);
  const endLimit = istDayEnd(endDay).getTime();

  while (cur.getTime() <= endLimit) {
    days.push(istDay(cur));
    cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
  }
  return days;
}

/** True if instant is within the IST calendar day YYYY-MM-DD */
export function isWithinISTDay(instant: Date | string, dayStr: string): boolean {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  return istDay(d) === dayStr;
}

// ─────────────────────── Zod Schemas ───────────────────────

export const reportDateRangeQuerySchema = z.object({
  preset: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  serviceId: z.string().optional(),
  categoryId: z.string().optional(),
});

export type ReportDateRangeQuery = z.infer<typeof reportDateRangeQuerySchema>;

export const reportDashboardKpisSchema = z.object({
  revenue: z.number(), // paise
  orders: z.number(),
  newCustomers: z.number(),
  activeApplications: z.number(),
});
export type ReportDashboardKpis = z.infer<typeof reportDashboardKpisSchema>;

export const reportDailySeriesPointSchema = z.object({
  date: z.string(), // YYYY-MM-DD in IST
  revenue: z.number(), // paise
  orders: z.number(),
});
export type ReportDailySeriesPoint = z.infer<typeof reportDailySeriesPointSchema>;

export const reportSlaBreachSchema = z.object({
  id: z.string(),
  code: z.string(),
  serviceName: z.string(),
  customerName: z.string(),
  slaDueAt: z.string(),
  status: z.string(),
  link: z.string(),
});
export type ReportSlaBreach = z.infer<typeof reportSlaBreachSchema>;

export const reportWaitingDocumentSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  applicationCode: z.string(),
  serviceName: z.string(),
  documentName: z.string(),
  uploadedAt: z.string(),
  link: z.string(),
});
export type ReportWaitingDocument = z.infer<typeof reportWaitingDocumentSchema>;

export const reportNeedsAttentionSchema = z.object({
  slaBreaches: z.array(reportSlaBreachSchema),
  waitingDocuments: z.array(reportWaitingDocumentSchema),
});
export type ReportNeedsAttention = z.infer<typeof reportNeedsAttentionSchema>;

export const reportDashboardResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    preset: z.string().optional(),
  }),
  kpis: reportDashboardKpisSchema,
  series: z.array(reportDailySeriesPointSchema),
  needsAttention: reportNeedsAttentionSchema,
});
export type ReportDashboardResponse = z.infer<typeof reportDashboardResponseSchema>;

export const reportSalesResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    preset: z.string().optional(),
  }),
  total: z.object({
    revenue: z.number(),
    orders: z.number(),
    discountTotal: z.number(),
    refundTotal: z.number(),
  }),
  monthly: z.array(
    z.object({
      month: z.string(), // YYYY-MM
      label: z.string(), // Oct 2026
      revenue: z.number(),
      orders: z.number(),
    }),
  ),
  serviceWise: z.array(
    z.object({
      serviceId: z.string(),
      serviceName: z.string(),
      categoryName: z.string(),
      orders: z.number(),
      revenue: z.number(),
    }),
  ),
  categoryWise: z.array(
    z.object({
      categoryId: z.string(),
      categoryName: z.string(),
      orders: z.number(),
      revenue: z.number(),
    }),
  ),
  couponImpact: z.object({
    discountGiven: z.number(),
    ordersWithCoupon: z.number(),
    coupons: z.array(
      z.object({
        code: z.string(),
        type: z.string(),
        ordersCount: z.number(),
        discountGiven: z.number(),
      }),
    ),
  }),
});
export type ReportSalesResponse = z.infer<typeof reportSalesResponseSchema>;

export const reportCustomersResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    preset: z.string().optional(),
  }),
  total: z.number(),
  newInRange: z.number(),
  activeLast90Days: z.number(),
});
export type ReportCustomersResponse = z.infer<typeof reportCustomersResponseSchema>;

export const reportServicePopularItemSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  categoryName: z.string(),
  orders: z.number(),
  revenue: z.number(), // paise
  avgTurnaroundDays: z.number().nullable(),
  slaBreaches: z.number(),
});
export type ReportServicePopularItem = z.infer<typeof reportServicePopularItemSchema>;

export const reportApplicationStatusItemSchema = z.object({
  status: z.string(),
  label: z.string(),
  count: z.number(),
});
export type ReportApplicationStatusItem = z.infer<typeof reportApplicationStatusItemSchema>;

export const reportSlaBreachPerServiceItemSchema = z.object({
  serviceId: z.string(),
  serviceName: z.string(),
  categoryName: z.string(),
  breachCount: z.number(),
});
export type ReportSlaBreachPerServiceItem = z.infer<typeof reportSlaBreachPerServiceItemSchema>;

export const reportServicesResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    preset: z.string().optional(),
  }),
  summary: z.object({
    totalOrders: z.number(),
    totalRevenue: z.number(), // paise
    avgTurnaroundDays: z.number(),
    totalSlaBreaches: z.number(),
  }),
  popularServices: z.array(reportServicePopularItemSchema),
  applicationsByStatus: z.array(reportApplicationStatusItemSchema),
  slaBreaches: z.array(reportSlaBreachPerServiceItemSchema),
});
export type ReportServicesResponse = z.infer<typeof reportServicesResponseSchema>;

export const reportConsultantItemSchema = z.object({
  consultantId: z.string(),
  name: z.string(),
  slug: z.string(),
  category: z.string(),
  verificationStatus: z.string(),
  rating: z.number(),
  reviewCount: z.number(),
  bookingsCount: z.number(),
  bookingRevenue: z.number(), // paise
});
export type ReportConsultantItem = z.infer<typeof reportConsultantItemSchema>;

export const reportConsultantsStatusCountSchema = z.object({
  status: z.string(),
  label: z.string(),
  count: z.number(),
});
export type ReportConsultantsStatusCount = z.infer<typeof reportConsultantsStatusCountSchema>;

export const reportConsultantsResponseSchema = z.object({
  range: z.object({
    from: z.string(),
    to: z.string(),
    preset: z.string().optional(),
  }),
  summary: z.object({
    total: z.number(),
    active: z.number(),
    bookingsCount: z.number(),
    bookingRevenue: z.number(), // paise
    averageRating: z.number(),
  }),
  byVerificationStatus: z.array(reportConsultantsStatusCountSchema),
  consultants: z.array(reportConsultantItemSchema),
});
export type ReportConsultantsResponse = z.infer<typeof reportConsultantsResponseSchema>;


