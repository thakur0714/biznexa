import { z } from 'zod';

export const addDeliverableInputSchema = z.object({
  title: z.string().trim().min(1).max(150),
  fileId: z.string().uuid(),
}).strict();
export type AddDeliverableInput = z.infer<typeof addDeliverableInputSchema>;

export const deliverableSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  fileId: z.string().uuid(),
  fileName: z.string(),
  createdAt: z.string().datetime(),
}).strict();
export type Deliverable = z.infer<typeof deliverableSchema>;

export const deliverableListSchema = z.array(deliverableSchema);
export type DeliverableList = z.infer<typeof deliverableListSchema>;
