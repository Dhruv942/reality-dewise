import { z } from 'zod';

// Sign in with the account's email OR its username (each user has their own username and password).
export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email('Email must be valid')).optional(),
    username: z.string().trim().toLowerCase().min(1).max(50).optional(),
    password: z.string({ error: 'Password is required' }).min(1, 'Password is required').max(200),
  })
  .refine((v) => v.email || v.username, { message: 'Email or username is required', path: ['email'] });

export type LoginInput = z.infer<typeof loginSchema>;
