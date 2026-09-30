import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string({ error: 'Email is required' }).trim().toLowerCase().max(254).pipe(z.email('Email must be valid')),
  password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
