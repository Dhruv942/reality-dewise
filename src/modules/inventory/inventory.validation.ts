import { z } from 'zod';
import { INVENTORY_STATUSES, PRICE_BANDS, PROPERTY_TYPES, TRANSACTION_TYPES } from '../catalog/catalog.policy';

const text = (max: number) => z.string().trim().max(max);
const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(200);
const money = z.number({ error: 'Price must be a number' }).min(0).max(1e12);
export const idParam = z.object({ id: z.uuid('Invalid id') });

const inventoryFields = {
  propertyId: z.uuid('Invalid property id'),
  name,
  description: text(2000).nullish(),
  location: text(300).nullish(),
  transactionType: z.enum(TRANSACTION_TYPES).nullish(),
  propertyType: z.enum(PROPERTY_TYPES).nullish(),
  minPrice: money.nullish(),
  maxPrice: money.nullish(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  availableFrom: z.iso.date().nullish(),
};

const validPriceRange = (v: { minPrice?: number | null; maxPrice?: number | null }, ctx: z.RefinementCtx) => {
  if (v.minPrice !== null && v.minPrice !== undefined && v.maxPrice !== null && v.maxPrice !== undefined && v.minPrice > v.maxPrice) {
    ctx.addIssue({ code: 'custom', path: ['minPrice'], message: 'Minimum price cannot exceed maximum price' });
  }
};

export const createInventorySchema = z.strictObject(inventoryFields).superRefine(validPriceRange);

export const updateInventorySchema = z.strictObject({ ...inventoryFields, propertyId: undefined }).partial().superRefine(validPriceRange).refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });
export const statusSchema = z.strictObject({ status: z.enum(INVENTORY_STATUSES) });
export const listInventoryQuery = z.object({
  propertyId: z.uuid('Invalid property id').optional(),
  projectId: z.uuid('Invalid project id').optional(),
  status: z.enum(INVENTORY_STATUSES).optional(),
  transactionType: z.enum(TRANSACTION_TYPES).optional(),
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  priceBand: z.enum(PRICE_BANDS).optional(),
  search: text(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
