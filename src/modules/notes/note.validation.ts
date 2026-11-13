import { z } from 'zod';

export const idParam = z.object({ id: z.uuid('Invalid id') });

const title = z.string({ error: 'Title is required' }).trim().min(1, 'Title is required').max(200, 'Title must be at most 200 characters');
const content = z.string({ error: 'Content must be text' }).max(20000, 'Content must be at most 20000 characters');

export const createNoteSchema = z.strictObject({
  title,
  content: content.optional().default(''),
});

export const updateNoteSchema = z
  .strictObject({
    title: title.optional(),
    content: content.optional(),
  })
  .refine((v) => v.title !== undefined || v.content !== undefined, { message: 'At least one field is required' });

export const listNotesQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
