import { z } from 'zod';

export const clearEntriesInputSchema = z.object({
  action: z.literal('clearEntries'),
  confirmation: z.literal('清空积分'),
  entriesRevision: z.string().regex(/^[a-f0-9]{64}$/),
  operationPassword: z.string().min(1).max(128),
}).strict();

export type ClearEntriesInput = z.infer<typeof clearEntriesInputSchema>;
