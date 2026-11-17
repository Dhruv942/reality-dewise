import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(200);

export const idParam = z.object({ id: z.uuid('Invalid id') });
export const createProjectSchema = z.strictObject({
  name,
  description: text(2000).nullish(),
  location: text(300).nullish(),
});
export const updateProjectSchema = createProjectSchema.partial().refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export const projectListQuery = z.object({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
  search: text(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
