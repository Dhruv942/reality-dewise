import { z } from 'zod';

const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(100);
const email = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Email must be valid'));
const phone = z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Phone must be 7-15 digits, optional leading +');
const username = z
  .string({ error: 'Username is required' })
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/, 'Username must be 3-50 characters: letters, digits, dot, underscore or hyphen');
const password = z
  .string({ error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long');
const teamId = z.uuid('Invalid team id');

export const idParam = z.object({ id: z.uuid('Invalid id') });
export const executiveIdParam = z.object({ executiveId: z.uuid('Invalid executive id') });

export const createExecutiveSchema = z.strictObject({
  name,
  email,
  phone: phone.nullish(),
  username,
  password,
  teamId: teamId.nullish(),
});

// strictObject: role, password, isActive etc. are rejected here (they have dedicated rules/endpoints).
export const updateExecutiveSchema = z
  .strictObject({
    name: name.optional(),
    email: email.optional(),
    phone: phone.nullable().optional(),
    username: username.optional(),
    teamId: teamId.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const passwordSchema = z.strictObject({ password });
export const statusSchema = z.strictObject({ isActive: z.boolean({ error: 'isActive must be a boolean' }) });
export const assignTeamSchema = z.strictObject({ teamId });

export const listExecutivesQuery = z.object({
  teamId: teamId.optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().max(100).optional(),
});
