import { z } from 'zod';
import { isValidTimeZone } from '../leads/lead.model';
import { LEAD_STATUSES } from '../leads/lead.model';
import { PROPERTY_SOURCES } from '../properties/property.model';
import { PRICE_BANDS, PROPERTY_TYPES, TRANSACTION_TYPES } from '../catalog/catalog.policy';
import { parse } from '../../utils/validate';

const optionalUuid = z.uuid().optional();
const nonNegative = (field: string) => z.coerce.number({ error: `${field} must be a number` }).finite().min(0, `${field} cannot be negative`).max(1e14, `${field} is too large`).optional();

export const reportQuerySchema = z.strictObject({
  fromDate: z.iso.date().optional(),
  toDate: z.iso.date().optional(),
  managerId: optionalUuid,
  executiveId: optionalUuid,
  source: z.enum(PROPERTY_SOURCES).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  projectId: optionalUuid,
  propertyId: optionalUuid,
  transactionType: z.enum(TRANSACTION_TYPES).optional(),
  propertyCategory: z.enum(PROPERTY_TYPES).optional(),
  location: z.string().trim().max(200).optional(),
  minPrice: nonNegative('minPrice'),
  maxPrice: nonNegative('maxPrice'),
  priceBand: z.enum(PRICE_BANDS).optional(),
  tz: z.string().refine(isValidTimeZone, 'tz must be an IANA timezone').default('UTC'),
  limit: z.coerce.number().int().min(1).max(5000).default(100),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  format: z.enum(['json', 'csv', 'excel']).default('json'),
}).superRefine((value, ctx) => {
  if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
    ctx.addIssue({ code: 'custom', path: ['fromDate'], message: 'fromDate must be on or before toDate' });
  }
  if (value.minPrice !== undefined && value.maxPrice !== undefined && value.minPrice > value.maxPrice) {
    ctx.addIssue({ code: 'custom', path: ['minPrice'], message: 'minPrice cannot exceed maxPrice' });
  }
});

export const parseReportFilters = (query: unknown) => parse(reportQuerySchema, query);
