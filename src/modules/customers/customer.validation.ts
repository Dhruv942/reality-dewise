import { z } from 'zod';
import { normalizeMobile } from '../../utils/mobile';

export const customerName = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(100);
export const customerEmail = z.string().trim().toLowerCase().max(254).pipe(z.email('Email must be valid'));
export const customerMobile = z
  .string({ error: 'Mobile number is required' })
  .trim()
  .transform((v, ctx) => {
    const n = normalizeMobile(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Mobile number is invalid' });
      return z.NEVER;
    }
    return n;
  });

export const idParam = z.object({ id: z.uuid('Invalid id') });

export const updateCustomerSchema = z
  .strictObject({ name: customerName.optional(), email: customerEmail.nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listCustomersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
