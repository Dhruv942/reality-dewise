import type { PoolClient } from 'pg';
import { pool, withTransaction } from '../db/pool';
import type { Customer, Lead } from '../models/types';
import { assignmentRepository } from '../repositories/assignmentRepository';
import { LeadFilters } from '../repositories/leadFilters';
import { leadRepository } from '../repositories/leadRepository';
import { projectRepository } from '../repositories/projectRepository';
import { BusinessRuleError, NotFoundError } from '../utils/errors';
import { Pagination, toPage } from '../utils/pagination';
import { assignLead } from './assignmentService';
import { findOrCreateCustomer } from './customerService';
import { changeLeadStatus } from './leadStatusService';
import type { LeadStatus } from '../models/types';

export interface CreateLeadInput {
  name: string; mobile: string; email?: string | null;
  projectId?: number; projectName?: string;
  source: string; externalId?: string; requirement?: string; budget?: number;
  enquiryId?: number; propertyId?: number; metadata?: Record<string, unknown>;
}

export interface CreateLeadResult {
  lead: Lead;
  customer: Customer;
  isExistingCustomer: boolean;
  /** true when this (source, externalId) had already been received: the original lead is returned, nothing is created. */
  duplicate: boolean;
  previousLeads: unknown[];
  previousEnquiries: unknown[];
}

/**
 * The whole intake in one transaction: resolve project -> find/create customer -> create lead -> auto-assign.
 * A failure anywhere leaves nothing half-created.
 */
export async function createLeadInTx(tx: PoolClient, input: CreateLeadInput): Promise<CreateLeadResult> {
  const project = input.projectId
    ? await projectRepository.findById(tx, input.projectId)
    : await projectRepository.findByName(tx, input.projectName!);
  if (!project) throw new BusinessRuleError('Project not found');

  const { customer, created } = await findOrCreateCustomer(tx, { name: input.name, mobile: input.mobile, email: input.email });
  const previousLeads = await leadRepository.previousLeads(tx, customer.id);
  const previousEnquiries = await leadRepository.previousEnquiries(tx, customer.mobile);

  let lead = await leadRepository.insertIgnoreDuplicate(tx, {
    customerId: customer.id, projectId: project.id, propertyId: input.propertyId, enquiryId: input.enquiryId,
    source: input.source, externalId: input.externalId, requirement: input.requirement, budget: input.budget, metadata: input.metadata,
  });

  if (!lead) {
    // Portal retried the same lead: idempotent replay.
    const existing = (await leadRepository.findBySourceExternal(tx, input.source, input.externalId!))!;
    return { lead: existing, customer, isExistingCustomer: true, duplicate: true, previousLeads, previousEnquiries };
  }

  await leadRepository.insertStatusHistory(tx, { leadId: lead.id, fromStatus: null, toStatus: 'NEW', reason: `Received from ${input.source}` });
  const allocation = await assignLead(tx, lead.id);
  if (allocation) lead = allocation.lead;

  return { lead, customer, isExistingCustomer: !created, duplicate: false, previousLeads, previousEnquiries };
}

export const createLead = (input: CreateLeadInput) => withTransaction((tx) => createLeadInTx(tx, input));

export async function getLead(id: number) {
  const lead = await leadRepository.findDetail(pool, id);
  if (!lead) throw new NotFoundError('Lead');
  return lead;
}

export async function getLeadHistory(id: number) {
  await getLead(id);
  const [assignments, statusHistory] = await Promise.all([
    assignmentRepository.listByLead(pool, id), leadRepository.statusHistory(pool, id),
  ]);
  return { assignments, statusHistory };
}

export async function listLeads(filters: LeadFilters, p: Pagination) {
  return toPage(await leadRepository.list(pool, filters, p), p);
}

export async function updateLeadStatus(id: number, status: LeadStatus, opts: { changedBy?: number; reason?: string }) {
  await withTransaction((tx) => changeLeadStatus(tx, id, status, opts));
  return getLead(id);
}
