import { withTransaction } from '../../database/transaction';
import { AppError, NotFoundError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';
import * as assignmentRepo from '../assignment/assignment.repository';
import { toHistoryDto } from '../assignment/assignment.model';
import { assignPendingLeads } from '../leads/lead.service';
import { publishAssignment } from '../leads/lead.events';
import type { ActivityRow } from '../leads/lead-activity.repository';
import * as repo from './property.repository';
import { toPropertyDto, type PropertyRow } from './property.model';

async function getProperty(id: string): Promise<PropertyRow> {
  const p = await repo.findById(id);
  if (!p) throw new NotFoundError('Property not found');
  return p;
}

export const listProperties = async (f: Parameters<typeof repo.list>[0]) => (await repo.list(f)).map(toPropertyDto);

export async function getPropertyDetails(id: string) {
  const p = await getProperty(id);
  const executives = await repo.listExecutives(id);
  return {
    ...toPropertyDto(p),
    executives: executives.map((e) => ({ id: e.id, name: e.name, username: e.username, isActive: e.is_active })),
  };
}

export async function updateProperty(
  id: string,
  input: { name?: string; description?: string | null; location?: string | null; isActive?: boolean },
) {
  await getProperty(id);
  await repo.updateDetails(id, {
    name: input.name?.replace(/\s+/g, ' '),
    description: input.description,
    location: input.location,
    is_active: input.isActive,
  });
  return getPropertyDetails(id);
}

/** Inactive properties stop receiving leads; the row stays for lead history. */
export async function setPropertyStatus(id: string, isActive: boolean) {
  await getProperty(id);
  await repo.updateDetails(id, { is_active: isActive });
  return getPropertyDetails(id);
}

/** Every listed executive must exist, be an active SALES user, and not be deleted. */
async function assertAssignable(executiveIds: string[]): Promise<void> {
  for (const eid of executiveIds) {
    const e = await executiveRepo.findById(eid);
    if (!e || e.deleted_at) throw new AppError(400, 'Executive not found');
    if (e.role !== 'SALES') throw new AppError(400, 'User is not an executive');
    if (!e.is_active) throw new AppError(409, `Executive ${e.name} is inactive`);
  }
}

/**
 * Sets the hand-picked executive list for the property (full replace; [] un-assigns it).
 * Leads that were waiting as PENDING_ASSIGNMENT are assigned straight away, oldest first, through
 * the same round-robin. The list change and those assignments commit together.
 */
export async function setExecutives(id: string, executiveIds: string[]) {
  await getProperty(id);
  await assertAssignable(executiveIds);
  const assignedIds: string[] = [];
  const activities: ActivityRow[] = [];
  const assignedPendingLeads = await withTransaction(async (tx) => {
    await repo.replaceExecutives(tx, id, executiveIds);
    return assignPendingLeads(id, tx, assignedIds, activities);
  });
  // Committed: tell the newly assigned executives (and admin/managers) about each lead.
  for (const leadId of assignedIds) await publishAssignment({ leadId, previousExecutiveId: null, reason: 'PENDING_ASSIGNED', activities: activities.filter((a) => a.lead_id === leadId) });
  return { ...(await getPropertyDetails(id)), assignedPendingLeads };
}

export async function getAssignmentHistory(id: string, limit: number, offset: number) {
  const p = await getProperty(id);
  const rows = await assignmentRepo.listHistoryForProperty(id, limit, offset);
  return { property: { id: p.id, name: p.name }, limit, offset, history: rows.map(toHistoryDto) };
}
