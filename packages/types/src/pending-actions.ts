import { z } from 'zod';

export const pendingActionKindSchema = z.enum([
  'upload_document',
  'reupload_document',
  'pay_balance',
  'read_message',
]);

export const pendingActionSchema = z.object({
  kind: pendingActionKindSchema,
  applicationId: z.string().uuid(),
  applicationCode: z.string(),
  serviceName: z.string(),
  title: z.string(),
  href: z.string(),
});

export const pendingActionsResponseSchema = z.object({
  items: z.array(pendingActionSchema),
});

export type PendingActionKind = z.infer<typeof pendingActionKindSchema>;
export type PendingAction = z.infer<typeof pendingActionSchema>;
export type PendingActionsResponse = z.infer<typeof pendingActionsResponseSchema>;
