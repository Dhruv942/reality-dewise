import { pool, insertRow, updateRow, withTransaction } from '../db/pool';
import type { Enquiry } from '../models/types';
import { enquiryRepository } from '../repositories/enquiryRepository';
import { projectRepository } from '../repositories/projectRepository';
import { propertyRepository } from '../repositories/propertyRepository';
import { BusinessRuleError, ConflictError, NotFoundError } from '../utils/errors';
import { normalizeMobile } from '../utils/mobile';
import { Pagination, toPage } from '../utils/pagination';
import { createLeadInTx } from './leadService';

export interface EnquiryInput {
  name: string; mobile: string; email?: string | null; requirement?: string | null; bhk?: number | null;
  budget?: number | null; projectId?: number | null; notes?: string | null; createdBy?: number | null; metadata?: Record<string, unknown>;
}

export async function createEnquiry(input: EnquiryInput) {
  if (input.projectId && !(await projectRepository.findById(pool, input.projectId))) throw new BusinessRuleError('Project not found');
  return insertRow<Enquiry>(pool, 'enquiries', { ...input, name: input.name.trim(), mobile: normalizeMobile(input.mobile) });
}

export async function getEnquiry(id: number) {
  const e = await enquiryRepository.findById(pool, id);
  if (!e) throw new NotFoundError('Enquiry');
  return e;
}

export async function listEnquiries(f: { status?: string; projectId?: number; mobile?: string }, p: Pagination) {
  return toPage(await enquiryRepository.list(pool, { ...f, mobile: f.mobile ? normalizeMobile(f.mobile) : undefined }, p), p);
}

export async function updateEnquiry(id: number, patch: Partial<EnquiryInput> & { status?: 'CANCELLED' }) {
  const e = await getEnquiry(id);
  if (e.status !== 'PENDING') throw new BusinessRuleError(`Enquiry is already ${e.status}`);
  const data = { ...patch, mobile: patch.mobile ? normalizeMobile(patch.mobile) : undefined };
  await updateRow(pool, 'enquiries', id, data);
  return getEnquiry(id);
}

/** Inventory that currently fits the enquiry (project / BHK / budget, whichever the enquiry states). */
export async function findMatchingProperties(id: number) {
  return propertyRepository.matchesFor(pool, await getEnquiry(id));
}

/**
 * Enquiry -> Lead, atomically: lock enquiry -> find/create customer -> create lead -> normal round-robin
 * assignment -> mark enquiry CONVERTED. The enquiry<->lead link is leads.enquiry_id (UNIQUE), so an enquiry
 * can never produce two leads even under concurrent requests.
 */
export async function convertToLead(id: number, input: { projectId?: number; propertyId?: number }) {
  return withTransaction(async (tx) => {
    const enquiry = await enquiryRepository.lockById(tx, id);
    if (!enquiry) throw new NotFoundError('Enquiry');
    if (enquiry.status !== 'PENDING') throw new ConflictError(`Enquiry is already ${enquiry.status}`);

    let projectId = input.projectId ?? enquiry.projectId ?? undefined;
    if (input.propertyId) {
      const property = await propertyRepository.lockById(tx, input.propertyId);
      if (!property) throw new BusinessRuleError('Property not found');
      if (property.availability !== 'AVAILABLE') throw new BusinessRuleError(`Property is ${property.availability}`);
      if (input.projectId && input.projectId !== property.projectId) throw new BusinessRuleError('Property does not belong to the given project');
      projectId = property.projectId;
    }
    if (!projectId) throw new BusinessRuleError('projectId (or propertyId) is required to convert an enquiry without a project');

    const result = await createLeadInTx(tx, {
      name: enquiry.name, mobile: enquiry.mobile, email: enquiry.email, projectId,
      source: 'direct', requirement: enquiry.requirement ?? undefined, budget: enquiry.budget ?? undefined,
      enquiryId: enquiry.id, propertyId: input.propertyId,
    });
    await enquiryRepository.markConverted(tx, enquiry.id, result.customer.id);
    return { enquiry: await enquiryRepository.findById(tx, enquiry.id), ...result };
  });
}
