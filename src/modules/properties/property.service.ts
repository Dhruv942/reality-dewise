import { withTransaction } from '../../database/transaction';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';
import * as assignmentRepo from '../assignment/assignment.repository';
import { toHistoryDto } from '../assignment/assignment.model';
import { assignPendingLeads } from '../leads/lead.service';
import { publishAssignment } from '../leads/lead.events';
import type { ActivityRow } from '../leads/lead-activity.repository';
import * as repo from './property.repository';
import { toPropertyDto, type PropertyRow } from './property.model';
import { classifyPriceBand } from '../catalog/catalog.policy';
import * as projectService from '../projects/project.service';

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
  input: { name?: string; description?: string | null; location?: string | null; isActive?: boolean; projectId?: string | null; transactionType?: any; propertyType?: any; minPrice?: number | null; maxPrice?: number | null; currency?: string },
) {
  const current = await getProperty(id);
  const nextMin = input.minPrice !== undefined ? input.minPrice : (current.min_price === null ? null : Number(current.min_price));
  const nextMax = input.maxPrice !== undefined ? input.maxPrice : (current.max_price === null ? null : Number(current.max_price));
  if (input.projectId) await projectService.assertActive(input.projectId);
  await repo.updateDetails(id, {
    name: input.name?.replace(/\s+/g, ' '),
    description: input.description,
    location: input.location,
    is_active: input.isActive,
    project_id: input.projectId,
    transaction_type: input.transactionType,
    property_type: input.propertyType,
    min_price: input.minPrice,
    max_price: input.maxPrice,
    currency: input.currency,
    price_band: input.minPrice !== undefined || input.maxPrice !== undefined ? classifyPriceBand(nextMin, nextMax) : current.price_band,
  });
  return getPropertyDetails(id);
}

/** Inactive properties stop receiving leads; the row stays for lead history. */
export async function setPropertyStatus(id: string, isActive: boolean) {
  await getProperty(id);
  await repo.updateDetails(id, { is_active: isActive, archived_at: isActive ? null : new Date() });
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

/** A manager may only put their own executives (users.manager_id = the manager) on a property. */
async function assertManagedBy(executiveIds: string[], managerId: string): Promise<void> {
  for (const eid of executiveIds) {
    const e = await executiveRepo.findById(eid);
    if (e && !e.deleted_at && e.role === 'SALES' && e.manager_id !== managerId) {
      throw new ForbiddenError('You can only assign your own executives to a property');
    }
  }
}

/**
 * Sets the hand-picked executive list for the property (full replace; [] un-assigns it).
 * Leads that were waiting as PENDING_ASSIGNMENT are assigned straight away, oldest first, through
 * the same round-robin. The list change and those assignments commit together.
 *
 * With `managerId` (a manager editing) the list is only THEIR part: `executiveIds` must all be their own
 * executives, and the executives of the property that report to someone else stay exactly as they are, so a
 * manager can never remove or replace another manager's (or an unmanaged) executive.
 */
export async function setExecutives(id: string, executiveIds: string[], managerId?: string) {
  await getProperty(id);
  await assertAssignable(executiveIds);
  if (managerId) await assertManagedBy(executiveIds, managerId);
  const assignedIds: string[] = [];
  const activities: ActivityRow[] = [];
  const assignedPendingLeads = await withTransaction(async (tx) => {
    let finalIds = executiveIds;
    if (managerId) {
      await repo.lockForUpdate(tx, id);
      finalIds = [...new Set([...(await repo.listExecutiveIdsNotManagedBy(tx, id, managerId)), ...executiveIds])];
    }
    await repo.replaceExecutives(tx, id, finalIds);
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
