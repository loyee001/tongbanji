import { z } from 'zod';

export function createRuleInputSchema(categories: readonly string[]) {
  const fields = {
    title: z.string().trim().min(1).max(80),
    category: z.string().refine(value => categories.includes(value)),
    points: z.number().int().min(-100).max(100).refine(value => value !== 0),
    note: z.string().trim().max(500),
  };
  const target = { id: z.string().min(1).max(100), version: z.number().int().min(1) };
  return z.discriminatedUnion('action', [
    z.object({ action: z.literal('createRule'), id: z.string().uuid(), ...fields }).strict(),
    z.object({ action: z.literal('updateRule'), ...target, ...fields }).strict(),
    z.object({ action: z.literal('deleteRule'), ...target }).strict(),
    z.object({ action: z.literal('restoreRule'), ...target }).strict(),
  ]);
}

export type RuleMutation = z.infer<ReturnType<typeof createRuleInputSchema>>;
