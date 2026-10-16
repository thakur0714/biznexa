import { z } from 'zod';
import { APPLICATION_STATUSES } from './status';

/** Customer dashboard summary (M5.2). Money is integer paise. */
export const dashboardSummarySchema = z.object({
  activeApplications: z.number().int().min(0),
  pendingActions: z.number().int().min(0),
  unpaidBalance: z.number().int().min(0),
  upcomingDueDates: z.array(z.object({
    id: z.string().uuid(),
    number: z.string(),
    type: z.string(),
    validUntil: z.string().datetime(),
  })),
  recentActivity: z.array(z.object({
    applicationId: z.string().uuid(),
    applicationCode: z.string(),
    serviceName: z.string(),
    status: z.enum(APPLICATION_STATUSES),
    statusLabel: z.string(),
    changedAt: z.string().datetime(),
  })),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
