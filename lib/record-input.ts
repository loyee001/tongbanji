import { z } from 'zod';

export type RecordItem = { title: string; category: string; points: number; quantity: number };
export type RecordInput = {
  action: 'record';
  batchId: string;
  studentIds: string[];
  date: string;
  items: RecordItem[];
};

export function createRecordInputSchema(categories: readonly string[], isValidDate: (date: string) => boolean) {
  const item = z.object({
    title: z.string().trim().min(1).max(80),
    category: z.string().refine(value => categories.includes(value)),
    points: z.number().int().min(-100).max(100).refine(value => value !== 0),
    quantity: z.number().int().min(1).max(100),
  }).strict();
  const common = {
    action: z.literal('record'),
    batchId: z.string().uuid(),
    studentIds: z.array(z.string().min(1).max(64)).min(1).max(200)
      .refine(ids => new Set(ids).size === ids.length),
    date: z.string().refine(isValidDate),
  };
  return z.union([
    z.object({ ...common, items: z.array(item).min(1).max(50) }).strict(),
    z.object({ ...common, ...item.shape, quantity: item.shape.quantity.default(1) }).strict(),
  ]).transform((value): RecordInput => {
    if ('items' in value) return value;
    const { title, category, points, quantity, ...rest } = value;
    return { ...rest, items: [{ title, category, points, quantity }] };
  });
}
