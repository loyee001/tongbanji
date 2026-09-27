import { z } from 'zod';

// Keep email accounts for recorders while allowing the administrator's short login.
export const loginAccountSchema = z.string().trim().toLowerCase().max(160).pipe(
  z.union([z.literal('admin'), z.string().email()]),
);
