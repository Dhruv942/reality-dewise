import { z } from 'zod';

const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(100);
const description = z.string().trim().max(500).nullable();

export const idParam = z.object({ id: z.uuid('Invalid id') });
export const teamIdParam = z.object({ teamId: z.uuid('Invalid team id') });

export const createTeamSchema = z.strictObject({ name, description: description.optional() });

export const updateTeamSchema = z
  .strictObject({ name: name.optional(), description: description.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const statusSchema = z.strictObject({ isActive: z.boolean({ error: 'isActive must be a boolean' }) });

export const listTeamsQuery = z.object({
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().max(100).optional(),
});
