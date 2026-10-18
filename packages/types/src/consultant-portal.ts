import { z } from 'zod';

export const consultantPortalBookingSchema = z.object({
  id: z.string().uuid(), code: z.string(), status: z.string(), type: z.string(), upcoming: z.boolean(),
  startAt: z.string().datetime(), endAt: z.string().datetime(), meetingLink: z.string().url().nullable(),
  fee: z.number().int(), customerName: z.string(),
});
export const consultantPortalBookingsSchema = z.object({ items: z.array(consultantPortalBookingSchema) });
export const consultantPortalApplicationSchema = z.object({
  id: z.string().uuid(), code: z.string(), status: z.string(), createdAt: z.string().datetime(),
  serviceName: z.string(), customerName: z.string(),
});
export const consultantPortalApplicationsSchema = z.object({ items: z.array(consultantPortalApplicationSchema) });
export const consultantPortalConversationSchema = z.object({
  applicationId: z.string().uuid(), applicationCode: z.string(), serviceName: z.string(), unreadCount: z.number().int().nonnegative(),
});
export const consultantPortalConversationsSchema = z.object({ items: z.array(consultantPortalConversationSchema) });
export const consultantPortalEarningsSchema = z.object({
  commissionPercent: z.number().int().min(0).max(100),
  items: z.array(z.object({ bookingId: z.string().uuid(), code: z.string(), completedAt: z.string().datetime(), fee: z.number().int(), commission: z.number().int(), net: z.number().int() })),
  monthlyTotals: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), fee: z.number().int(), commission: z.number().int(), net: z.number().int(), bookings: z.number().int() })),
});
export type ConsultantPortalBooking = z.infer<typeof consultantPortalBookingSchema>;
export type ConsultantPortalBookings = z.infer<typeof consultantPortalBookingsSchema>;
export type ConsultantPortalApplications = z.infer<typeof consultantPortalApplicationsSchema>;
export type ConsultantPortalConversations = z.infer<typeof consultantPortalConversationsSchema>;
export type ConsultantPortalEarnings = z.infer<typeof consultantPortalEarningsSchema>;
