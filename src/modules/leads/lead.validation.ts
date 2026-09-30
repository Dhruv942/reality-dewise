import { z } from 'zod';
import { customerEmail, customerMobile, customerName } from '../customers/customer.validation';
import { LEAD_STATUSES } from './lead.model';

export const idParam = z.object({ id: z.uuid('Invalid id') });

export const createLeadSchema = z.strictObject({
  name: customerName,
  mobile: customerMobile,
  email: customerEmail.nullish(),
  propertyId: z.uuid('Invalid property id'),
  message: z.string().trim().max(2000).nullish(),
  externalLeadId: z.string().trim().min(1).max(100).nullish(),
});

const status = z.enum(LEAD_STATUSES, { error: `Status must be one of: ${LEAD_STATUSES.join(', ')}` });
export const statusSchema = z.strictObject({ status });

export const listLeadsQuery = z.object({
  status: status.optional(),
  propertyId: z.uuid('Invalid property id').optional(),
  executiveId: z.uuid('Invalid executive id').optional(),
  customerId: z.uuid('Invalid customer id').optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
