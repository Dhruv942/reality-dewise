import { z } from 'zod';
import { PROPERTY_SOURCES } from './property.model';

const source = z
  .string({ error: 'Source is required' })
  .trim()
  .toUpperCase()
  .pipe(z.enum(PROPERTY_SOURCES, { error: `Source must be one of: ${PROPERTY_SOURCES.join(', ')}` }));
const externalPropertyId = z
  .string({ error: 'externalPropertyId is required' })
  .trim()
  .min(1, 'externalPropertyId is required')
  .max(100);
const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(200);
const description = z.string().trim().max(2000);
const location = z.string().trim().max(300);
const uuid = (label: string) => z.uuid(`Invalid ${label}`);

export const idParam = z.object({ id: z.uuid('Invalid id') });

export const createPropertySchema = z.strictObject({
  externalPropertyId,
  source,
  name,
  description: description.nullish(),
  location: location.nullish(),
  teamId: uuid('team id').nullish(),
  primaryExecutiveId: uuid('executive id').nullish(),
  isActive: z.boolean().optional(),
});

// Identity (source, externalPropertyId) and assignment (team, primary executive) are rejected here:
// they have their own rules/endpoints.
export const updatePropertySchema = z
  .strictObject({
    name: name.optional(),
    description: description.nullable().optional(),
    location: location.nullable().optional(),
    isActive: z.boolean({ error: 'isActive must be a boolean' }).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const statusSchema = z.strictObject({ isActive: z.boolean({ error: 'isActive must be a boolean' }) });

/** `primaryExecutiveId` lets the admin resolve an invalid primary in the same request (null = remove it). */
export const changeTeamSchema = z.strictObject({
  teamId: uuid('team id'),
  primaryExecutiveId: uuid('executive id').nullable().optional(),
});

export const setExecutiveSchema = z.strictObject({ executiveId: uuid('executive id') });

export const listPropertiesQuery = z.object({
  source: source.optional(),
  teamId: uuid('team id').optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().max(100).optional(),
});

export const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
