import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const externalId = text(200).min(1);
const externalName = text(300).min(1);
export const idParam = z.object({ id: z.uuid('Invalid id') });

const fields = {
  propertyId: z.uuid('Invalid property id'),
  portalSource: z.string().trim().min(2).max(64).transform((v) => v.toUpperCase()),
  externalPropertyId: externalId.nullish(),
  externalPropertyName: externalName.nullish(),
  externalListingUrl: z.url().max(1000).nullish(),
};
const requireIdentity = (v: { externalPropertyId?: string | null; externalPropertyName?: string | null }, ctx: z.RefinementCtx) => {
  if (!v.externalPropertyId && !v.externalPropertyName) ctx.addIssue({ code: 'custom', path: ['externalPropertyId'], message: 'External property id or name is required' });
};
export const createMappingSchema = z.strictObject(fields).superRefine(requireIdentity);
export const updateMappingSchema = z.strictObject({ ...fields, propertyId: fields.propertyId.optional(), portalSource: fields.portalSource.optional() }).partial().superRefine((v, ctx) => {
  if (v.externalPropertyId === null && v.externalPropertyName === null) ctx.addIssue({ code: 'custom', path: ['externalPropertyId'], message: 'External property id or name is required' });
});
export const listMappingQuery = z.object({
  propertyId: z.uuid('Invalid property id').optional(),
  portalSource: z.string().trim().min(2).max(64).transform((v) => v.toUpperCase()).optional(),
  externalPropertyId: text(200).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: text(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
