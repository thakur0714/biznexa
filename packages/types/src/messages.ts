/**
 * Application messaging threads (M4.11 part 1: text-only messages).
 *
 * Unread rule: `Message.readAt` means read by the OTHER side —
 * customer's unread = staff messages (`sender.isStaff === true`) with `readAt: null`;
 * staff unread = customer messages (`sender.isStaff === false`) with `readAt: null`.
 */
import { z } from 'zod';

export const postMessageInput = z
  .object({
    body: z
      .string()
      .trim()
      .max(4000, 'Message cannot exceed 4000 characters')
      .optional(),
    fileIds: z
      .array(z.string().uuid())
      .max(5, 'You can attach up to 5 files per message')
      .optional(),
  })
  .strict()
  .refine((data) => data.body || (data.fileIds && data.fileIds.length > 0), {
    message: 'Enter a message or attach a file',
    path: ['body'],
  });

export const postMessageInputSchema = postMessageInput;
export type PostMessageInput = z.infer<typeof postMessageInput>;

export const messageSenderSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isStaff: z.boolean(),
});
export type MessageSender = z.infer<typeof messageSenderSchema>;

export const messageAttachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().min(0),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  body: z.string().nullable(),
  sender: messageSenderSchema,
  attachments: z.array(messageAttachmentSchema).optional(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});
export type Message = z.infer<typeof messageSchema>;
export type ApplicationMessage = Message;

export const messageListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const messageListQuerySchema = messageListQuery;
export type MessageListQuery = z.output<typeof messageListQuery>;

/** Page 1 = the newest messages; each page is ordered oldest → newest for display. */
export const messageThreadPageSchema = z.object({
  items: z.array(messageSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
});
export const messagePageSchema = messageThreadPageSchema;
export type MessageThreadPage = z.infer<typeof messageThreadPageSchema>;
export type MessagePage = MessageThreadPage;

export const messageUnreadCountSchema = z.object({
  count: z.number().int().min(0),
});
export type MessageUnreadCount = z.infer<typeof messageUnreadCountSchema>;

export const markMessagesReadResponseSchema = z.object({
  count: z.number().int().min(0),
});
export type MarkMessagesReadResponse = z.infer<typeof markMessagesReadResponseSchema>;
