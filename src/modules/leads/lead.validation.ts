import { z } from 'zod';
import { customerEmail, customerMobile, customerName } from '../customers/customer.validation';
import { PROPERTY_SOURCES } from '../properties/property.model';
import { ENQUIRY_TYPES, LEAD_STATUSES, PIPELINE_STATUSES, isValidTimeZone } from './lead.model';

export const idParam = z.object({ id: z.uuid('Invalid id') });

export const createLeadSchema = z.strictObject({
  name: customerName,
  mobile: customerMobile,
  email: customerEmail.nullish(),
  propertyName: z.string({ error: 'Property name is required' }).trim().min(1, 'Property name is required').max(200),
  // The portal the enquiry came from. A property is one record regardless of portal; source is per lead.
  source: z
    .string({ error: 'Source is required' })
    .trim()
    .toUpperCase()
    .pipe(z.enum(PROPERTY_SOURCES, { error: `Source must be one of: ${PROPERTY_SOURCES.join(', ')}` })),
  // What the client wants, e.g. "3 BHK on Rent".
  requirement: z.string().trim().max(200).nullish(),
  // Does the client want to rent or buy? Optional; case-insensitive.
  enquiryType: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.enum(ENQUIRY_TYPES, { error: `Enquiry type must be one of: ${ENQUIRY_TYPES.join(', ')}` }))
    .nullish(),
  budget: z.number({ error: 'Budget must be a number (in rupees)' }).min(0).max(1e12).nullish(),
  message: z.string().trim().max(2000).nullish(),
  externalLeadId: z.string().trim().min(1).max(100).nullish(),
});

/** A manager adds a lead and must give it to one of the sales users of the teams they lead. */
export const managerCreateLeadSchema = createLeadSchema.extend({ executiveId: z.uuid('Invalid executive id') });

const filterStatus = z.enum(LEAD_STATUSES, { error: `Status must be one of: ${LEAD_STATUSES.join(', ')}` });
const setStatus = z.enum(PIPELINE_STATUSES, { error: `Status must be one of: ${PIPELINE_STATUSES.join(', ')}` });
export const statusSchema = z.strictObject({ status: setStatus });

export const tzQuery = z.object({ tz: z.string().refine(isValidTimeZone, 'tz must be an IANA timezone, e.g. Asia/Kolkata').optional() });

export const listLeadsQuery = z.object({
  status: filterStatus.optional(),
  propertyId: z.uuid('Invalid property id').optional(),
  executiveId: z.uuid('Invalid executive id').optional(),
  customerId: z.uuid('Invalid customer id').optional(),
  // Only the leads you marked important (true) or did not (false).
  important: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  isNew: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  // Filter by follow-up: overdue, due later today, on a later day, or nothing scheduled.
  followUp: z.enum(['overdue', 'today', 'upcoming', 'none'], { error: 'followUp must be one of: overdue, today, upcoming, none' }).optional(),
  // IANA timezone that defines "today" for the follow-up filter and state, e.g. Asia/Kolkata. Defaults to UTC.
  tz: z.string().refine(isValidTimeZone, 'tz must be an IANA timezone, e.g. Asia/Kolkata').optional(),
  assignedSince: z.iso.datetime({ offset: true, error: 'assignedSince must be an ISO date-time' }).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const assignLeadSchema = z.strictObject({ executiveId: z.uuid('Invalid executive id') });

/** `followUpAt: null` clears the follow-up (and its note). The date must carry an offset, e.g. 2026-10-12T10:30:00+05:30. */
export const followUpSchema = z.strictObject({
  followUpAt: z.union([z.iso.datetime({ offset: true, error: 'followUpAt must be an ISO date-time with offset, or null' }), z.null()], {
    error: 'followUpAt must be an ISO date-time with offset, or null',
  }),
  followUpNote: z.string({ error: 'followUpNote must be text' }).trim().max(500, 'followUpNote must be at most 500 characters').nullish(),
});
