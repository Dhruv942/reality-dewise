import { z } from 'zod';

const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(200);
const description = z.string().trim().max(2000);
const location = z.string().trim().max(300);

export const idParam = z.object({ id: z.uuid('Invalid id') });

// Properties are created automatically from leads, so there is no create schema. Only details can be edited.
export const updatePropertySchema = z
  .strictObject({
    name: name.optional(),
    description: description.nullable().optional(),
    location: location.nullable().optional(),
    isActive: z.boolean({ error: 'isActive must be a boolean' }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const statusSchema = z.strictObject({ isActive: z.boolean({ error: 'isActive must be a boolean' }) });

/** The full, hand-picked list. An empty list un-assigns the property. */
export const setExecutivesSchema = z.strictObject({
  executiveIds: z
    .array(z.uuid('Invalid executive id'))
    .max(100)
    .transform((ids) => [...new Set(ids)]),
});

export const listPropertiesQuery = z.object({
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  // assigned=false lists the properties that still need executives (their leads are pending).
  assigned: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().max(100).optional(),
});

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
