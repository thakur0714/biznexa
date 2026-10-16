import { z } from 'zod';

export const reminderStatuses = ['SCHEDULED', 'SENT', 'DONE', 'CANCELLED'] as const;
export type ReminderStatus = typeof reminderStatuses[number];

export const reminderSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  dueDate: z.string().datetime(),
  renewServiceSlug: z.string().nullable(),
  businessEntity: z.object({
    name: z.string(),
  }).nullable(),
});

export type Reminder = z.infer<typeof reminderSchema>;

export const reminderListResponseSchema = z.object({
  items: z.array(reminderSchema),
});

export type ReminderListResponse = z.infer<typeof reminderListResponseSchema>;
