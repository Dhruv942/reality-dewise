import { withTransaction } from '../../database/transaction';
import { AppError, NotFoundError } from '../../utils/errors';
import * as customerRepo from '../customers/customer.repository';
import * as propertyRepo from '../properties/property.repository';
import { propertyAssignmentService } from '../assignment/assignment.service';
import * as repo from './lead.repository';
import { toLeadDto, type LeadStatus } from './lead.model';

export interface NewLeadInput {
  name: string;
  mobile: string; // already normalised
  email?: string | null;
  propertyId: string;
  message?: string | null;
  /** Portal's own enquiry id. When given, submitting the same one again returns the existing lead. */
  externalLeadId?: string | null;
  rawPayload?: unknown;
}

/**
 * The single entry point for creating a lead: today the admin API, later the 99acres/Magicbricks
 * webhook. Customer upsert, lead insert and executive assignment are ONE transaction: an enquiry is
 * never stored half-assigned, and if no executive can take it nothing is written.
 */
export async function createLead(input: NewLeadInput) {
  const property = await propertyRepo.findById(input.propertyId);
  if (!property) throw new AppError(400, 'Property not found');

  const externalLeadId = input.externalLeadId ?? null;
  if (externalLeadId) {
    const existing = await repo.findByExternalId(property.source, externalLeadId);
    if (existing) return { created: false, lead: toLeadDto(existing) };
  }

  try {
    const leadId = await withTransaction(async (tx) => {
      const customer = await customerRepo.upsertByMobile(tx, {
        name: input.name,
        mobile: input.mobile,
        email: input.email ?? null,
      });
      const id = await repo.insert(tx, {
        customerId: customer.id,
        propertyId: property.id,
        source: property.source,
        message: input.message ?? null,
        externalLeadId,
        rawPayload: input.rawPayload,
      });
      const assignment = await propertyAssignmentService.assignLeadToProperty(property.id, id, tx);
      await repo.setAssignedExecutive(tx, id, assignment.executiveId);
      return id;
    });
    return { created: true, lead: toLeadDto((await repo.findById(leadId))!) };
  } catch (err) {
    // The same external enquiry arrived twice at once: the other request won, return its lead.
    if (externalLeadId && (err as { constraint?: string }).constraint === repo.LEAD_EXTERNAL_UNIQUE) {
      const winner = await repo.findByExternalId(property.source, externalLeadId);
      if (winner) return { created: false, lead: toLeadDto(winner) };
    }
    throw err;
  }
}

export const listLeads = async (f: repo.LeadFilters) => (await repo.list(f)).map(toLeadDto);

/** Pass `ownerId` for executives: they can only see their own leads. */
export async function getLead(id: string, ownerId?: string) {
  const lead = await repo.findById(id, ownerId);
  if (!lead) throw new NotFoundError('Lead not found');
  return toLeadDto(lead);
}

export async function updateStatus(id: string, status: LeadStatus, ownerId?: string) {
  await getLead(id, ownerId);
  await repo.setStatus(id, status);
  return getLead(id, ownerId);
}
