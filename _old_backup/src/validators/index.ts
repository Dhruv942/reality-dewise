import { z } from 'zod';

const mobileRegex = /^[0-9]{10}$/;

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const customerListQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
});

export const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  isActive: z.boolean().optional().default(true),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  mobile: z.string().regex(mobileRegex, 'Mobile must be 10 digits').optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional().default(true),
  teamId: z.coerce.number().int().positive().optional().nullable(),
});

export const updateUserSchema = createUserSchema.partial();

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  location: z.string().optional().nullable(),
  status: z.enum(['UPCOMING', 'ONGOING', 'COMPLETED', 'INACTIVE']).optional().default('ONGOING'),
  teamId: z.coerce.number().int().positive().optional().nullable(),
  slaMinutes: z.coerce.number().int().positive().optional().nullable(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const createPropertySchema = z.object({
  projectId: z.coerce.number().int().positive(),
  unitNumber: z.string().min(1).max(50),
  propertyType: z.string().default('APARTMENT'),
  bhk: z.coerce.number().int().positive().optional().nullable(),
  price: z.coerce.number().nonnegative(),
  areaSqft: z.coerce.number().positive().optional().nullable(),
  availability: z.enum(['AVAILABLE', 'BLOCKED', 'SOLD']).optional().default('AVAILABLE'),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
});

export const updatePropertySchema = createPropertySchema.partial();

export const propertyListQuerySchema = paginationSchema.extend({
  projectId: z.coerce.number().int().positive().optional(),
  availability: z.enum(['AVAILABLE', 'BLOCKED', 'SOLD']).optional(),
  bhk: z.coerce.number().int().positive().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
});

export const createLeadSchema = z.object({
  name: z.string().min(1).max(100),
  mobile: z.string().min(10).max(15),
  email: z.string().email().optional().nullable(),
  projectId: z.coerce.number().int().positive().optional(),
  projectName: z.string().optional(),
  source: z.string().min(1).default('99acres'),
  externalId: z.string().optional(),
  requirement: z.string().optional(),
  budget: z.coerce.number().nonnegative().optional(),
  enquiryId: z.coerce.number().int().positive().optional(),
  propertyId: z.coerce.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => data.projectId !== undefined || data.projectName !== undefined, {
  message: 'Either projectId or projectName must be provided',
});

export const listLeadsQuerySchema = paginationSchema.extend({
  projectId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  status: z.enum(['NEW', 'ASSIGNED', 'CONTACTED', 'FOLLOW_UP', 'CLOSED', 'LOST', 'INVALID']).optional(),
  source: z.string().optional(),
  search: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const contactLeadSchema = z.object({
  notes: z.string().optional(),
  nextFollowUpAt: z.coerce.date().optional(),
  userId: z.coerce.number().int().positive().optional(),
});

export const updateLeadStatusSchema = z.object({
  status: z.enum(['NEW', 'ASSIGNED', 'CONTACTED', 'FOLLOW_UP', 'CLOSED', 'LOST', 'INVALID']),
  reason: z.string().optional(),
  changedBy: z.coerce.number().int().positive().optional(),
});

export const addNoteSchema = z.object({
  note: z.string().min(1),
  authorId: z.coerce.number().int().positive().optional(),
});

export const createFollowUpSchema = z.object({
  scheduledAt: z.coerce.date(),
  notes: z.string().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
});

export const completeFollowUpSchema = z.object({
  notes: z.string().optional(),
  nextFollowUpAt: z.coerce.date().optional(),
});

export const rescheduleFollowUpSchema = z.object({
  scheduledAt: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const listFollowUpsQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'COMPLETED', 'MISSED', 'CANCELLED']).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createEnquirySchema = z.object({
  name: z.string().min(1).max(100),
  mobile: z.string().min(10).max(15),
  email: z.string().email().optional().nullable(),
  requirement: z.string().optional().nullable(),
  bhk: z.coerce.number().int().positive().optional().nullable(),
  budget: z.coerce.number().nonnegative().optional().nullable(),
  projectId: z.coerce.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  createdBy: z.coerce.number().int().positive().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateEnquirySchema = createEnquirySchema.partial().extend({
  status: z.enum(['CANCELLED']).optional(),
});

export const listEnquiriesQuerySchema = paginationSchema.extend({
  status: z.enum(['PENDING', 'CONVERTED', 'CANCELLED']).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  mobile: z.string().optional(),
});

export const convertEnquirySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  propertyId: z.coerce.number().int().positive().optional(),
});

export const dashboardSummaryQuerySchema = z.object({
  projectId: z.coerce.number().int().positive().optional(),
  teamId: z.coerce.number().int().positive().optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  status: z.enum(['NEW', 'ASSIGNED', 'CONTACTED', 'FOLLOW_UP', 'CLOSED', 'LOST', 'INVALID']).optional(),
  source: z.string().optional(),
  search: z.string().optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
});

export const listNotificationsQuerySchema = paginationSchema.extend({
  userId: z.coerce.number().int().positive().optional(),
  status: z.enum(['PENDING', 'SENT', 'FAILED']).optional(),
});

export const assignLeadSchema = z.object({
  userId: z.coerce.number().int().positive(),
});
