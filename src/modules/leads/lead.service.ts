import { withTransaction, type Db } from '../../database/transaction';
import { AppError, ForbiddenError, NotFoundError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';
import * as assignmentRepo from '../assignment/assignment.repository';
import * as settingsRepo from '../settings/settings.repository';
import { pool } from '../../database/pool';
import { env } from '../../config/env';
import * as customerRepo from '../customers/customer.repository';
import * as propertyRepo from '../properties/property.repository';
import type { UserRole } from '../users/user.model';
import type { CustomerType } from '../customers/customer.model';
import type { PropertySource } from '../properties/property.model';
import { propertyAssignmentService } from '../assignment/assignment.service';
import * as repo from './lead.repository';
import { publishAssignment, publishLeadCreated, publishSlaReassignment, publishSlaWarning, publishStatusUpdated } from './lead.events';
import { toLeadDto, type LeadStatus } from './lead.model';

export interface NewLeadInput {
  name: string;
  mobile: string; // already normalised
  email?: string | null;
  /** Name as the portal sent it. Matched to an existing property, or a stub is created once. */
  propertyName: string;
  source: PropertySource;
  budget?: number | null;
  requirement?: string | null;
  customerType?: CustomerType | null;
  message?: string | null;
  /** Portal's own enquiry id. When given, submitting the same one again returns the existing lead. */
  externalLeadId?: string | null;
  rawPayload?: unknown;
}

const pendingNotice = (propertyName: string) =>
  `No executive/team is assigned to ${propertyName}. Please assign an executive/team before processing this lead.`;

/**
 * The single entry point for creating a lead: today the admin API, later the 99acres/Magicbricks webhook.
 *
 *   find the property by normalised name (creating ONE stub if the name is new)
 *   -> save customer + lead -> round-robin over the property's hand-picked executives
 *   -> nobody to assign: the lead stays PENDING_ASSIGNMENT and `notice` says what to do.
 *
 * Everything is ONE transaction, so an enquiry is never stored half-assigned. The property name is
 * unique by normalised form in the database, so concurrent leads for a new property create it once.
 */
export async function createLead(input: NewLeadInput, viewerId?: string) {
  const source = input.source;
  const externalLeadId = input.externalLeadId ?? null;
  if (externalLeadId) {
    const existing = await repo.findByExternalId(source, externalLeadId, viewerId);
    if (existing) return { created: false, lead: toLeadDto(existing) };
  }

  try {
    const { leadId, notice } = await withTransaction(async (tx) => {
      const property = await propertyRepo.findOrCreateStub(tx, input.propertyName);
      const customer = await customerRepo.upsertByMobile(tx, {
        name: input.name,
        mobile: input.mobile,
        email: input.email ?? null,
        type: input.customerType ?? undefined,
      });
      const id = await repo.insert(tx, {
        customerId: customer.id,
        propertyId: property.id,
        source,
        message: input.message ?? null,
        requirement: input.requirement ?? null,
        budget: input.budget ?? null,
        propertyName: input.propertyName,
        externalLeadId,
        rawPayload: input.rawPayload,
      });
      const assignment = await propertyAssignmentService.assignLeadToProperty(property.id, id, tx);
      if (assignment) {
        await repo.markAssigned(tx, id, assignment.executiveId);
        return { leadId: id, notice: undefined };
      }
      const row = await propertyRepo.findById(property.id, tx);
      return { leadId: id, notice: pendingNotice(row!.name) };
    });
    await publishLeadCreated(leadId); // after the commit: a failed lead never announces itself
    return { created: true, lead: toLeadDto((await repo.findById(leadId, undefined, undefined, viewerId))!), ...(notice ? { notice } : {}) };
  } catch (err) {
    // The same external enquiry arrived twice at once: the other request won, return its lead.
    if (externalLeadId && (err as { constraint?: string }).constraint === repo.LEAD_EXTERNAL_UNIQUE) {
      const winner = await repo.findByExternalId(source, externalLeadId, viewerId);
      if (winner) return { created: false, lead: toLeadDto(winner) };
    }
    throw err;
  }
}

/**
 * Called when a property gets executives: assigns its PENDING_ASSIGNMENT leads, oldest first, through the
 * same round-robin. Runs inside the caller's transaction. Returns how many leads were assigned.
 * `assignedIds` (optional) collects those leads so the caller can announce them once its transaction commits.
 */
export async function assignPendingLeads(propertyId: string, tx: Db, assignedIds?: string[]): Promise<number> {
  const property = await propertyRepo.findById(propertyId, tx);
  if (!property?.is_active) return 0;
  let assigned = 0;
  for (const leadId of await repo.lockPendingIds(tx, propertyId)) {
    const result = await propertyAssignmentService.assignLeadToProperty(propertyId, leadId, tx);
    if (!result) break; // nobody available: the rest stay pending
    await repo.markAssigned(tx, leadId, result.executiveId);
    assignedIds?.push(leadId);
    assigned++;
  }
  return assigned;
}

/**
 * One lead plus the client's other enquiries (their history: property, requirement, budget, date, executive,
 * status, notes). With `ownerId` (executive) opening the lead also clears its "New" indicator.
 */
export async function getLeadDetail(id: string, ownerId?: string, managerId?: string, viewerId?: string) {
  if (!(await repo.findById(id, ownerId, managerId))) throw new NotFoundError('Lead not found');
  if (ownerId) await repo.markSeen(id, ownerId);
  const lead = toLeadDto((await repo.findById(id, ownerId, managerId, viewerId))!);
  const history = (await repo.listForCustomer(lead.customer.id, id, 50, viewerId)).map((r) => {
    const { customer: _c, ...entry } = toLeadDto(r);
    return entry;
  });
  return { ...lead, customerHistory: history, customerEnquiryCount: history.length + 1 };
}

/** Executive dashboard numbers: how many leads are new (unopened) and the split by status. */
export async function executiveSummary(executiveId: string) {
  const rows = await repo.summaryFor(executiveId);
  return {
    newLeads: rows.reduce((n, r) => n + r.unseen, 0),
    totalLeads: rows.reduce((n, r) => n + r.total, 0),
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.total])),
  };
}

export const listLeads = async (f: repo.LeadFilters) => (await repo.list(f)).map(toLeadDto);

/** Pass `ownerId` for executives: they can only see their own leads. */
export async function getLead(id: string, ownerId?: string, viewerId?: string) {
  const lead = await repo.findById(id, ownerId, undefined, viewerId);
  if (!lead) throw new NotFoundError('Lead not found');
  return toLeadDto(lead);
}

export async function updateStatus(
  id: string,
  status: Exclude<LeadStatus, 'PENDING_ASSIGNMENT'>,
  ownerId?: string,
  viewerId?: string,
) {
  const lead = await getLead(id, ownerId);
  if (lead.status === 'PENDING_ASSIGNMENT') {
    throw new AppError(409, 'This lead is pending assignment. Assign executives to its property first.');
  }
  await repo.setStatus(id, status);
  await publishStatusUpdated({ leadId: id, previousStatus: lead.status, actorId: viewerId });
  return getLead(id, ownerId, viewerId);
}

/**
 * Admin or manager gives a lead to a specific sales executive / executive manager (same role, same rules).
 *   ADMIN   : any lead, any active sales user.
 *   MANAGER : leads in their scope (their teams' leads or unassigned ones), only to sales users of the teams
 *             they lead.
 * Works for a pending lead (first assignment) and for reassignment. The round-robin pointer is not touched,
 * and the assignment history records who did it.
 */
export async function assignLead(id: string, executiveId: string, actor: { id: string; role: 'ADMIN' | 'MANAGER' }) {
  const managerId = actor.role === 'MANAGER' ? actor.id : undefined;
  const lead = await repo.findById(id, undefined, managerId);
  if (!lead) throw new NotFoundError('Lead not found');

  const target = await executiveRepo.findById(executiveId);
  if (!target || target.deleted_at) throw new AppError(400, 'Executive not found');
  if (target.role !== 'SALES') throw new AppError(400, 'Leads can only be assigned to sales executives or executive managers');
  if (!target.is_active) throw new AppError(409, 'Executive is inactive');
  if (managerId) {
    const { rowCount } = await pool.query('SELECT 1 FROM teams WHERE id = $1 AND manager_id = $2', [target.team_id, managerId]);
    if (!rowCount) throw new ForbiddenError('You can only assign leads to executives in the teams you manage');
  }

  if (lead.executive_id === executiveId) return getLead(id, undefined, actor.id); // already theirs: nothing to do
  await withTransaction(async (tx) => {
    await repo.assignTo(tx, id, executiveId);
    await assignmentRepo.insertHistory(tx, {
      propertyId: lead.property_id,
      executiveId,
      leadId: id,
      method: 'MANUAL',
      assignedById: actor.id,
    });
  });
  await publishAssignment({ leadId: id, previousExecutiveId: lead.executive_id, reason: 'MANUAL' });
  return getLead(id, undefined, actor.id);
}

/**
 * Marks (or unmarks) a lead as important for the logged-in user only. The user must be able to see the lead
 * through their own portal: admin any lead, manager their scope, sales user their own leads (otherwise 404).
 * Idempotent in both directions. Returns the lead as this user sees it.
 */
export async function setImportant(id: string, actor: { id: string; role: UserRole }, important: boolean) {
  const ownerId = actor.role === 'SALES' ? actor.id : undefined;
  const managerId = actor.role === 'MANAGER' ? actor.id : undefined;
  if (!(await repo.findById(id, ownerId, managerId))) throw new NotFoundError('Lead not found');
  if (important) await repo.markImportant(actor.id, id);
  else await repo.unmarkImportant(actor.id, id);
  return toLeadDto((await repo.findById(id, ownerId, managerId, actor.id))!);
}

/**
 * Moves ONE timed-out lead to the next eligible executive. All in one transaction:
 *   lock the lead and re-check it is still INCOMING and still past the timeout (SKIP LOCKED) ->
 *   pick the next executive with the active assignment rule, never the current one ->
 *   assign (assigned_at restarts the timer, seen_at is cleared so it is "new" for them) -> history row TIMEOUT.
 * A lead that was handled, already reassigned or manually reassigned in the meantime is skipped, so concurrent
 * sweeps can never reassign the same lead twice. The Important flag plays no part in any of this.
 */
export async function reassignTimedOutLead(leadId: string, minutes: number, at?: Date): Promise<'reassigned' | 'skipped'> {
  const moved = await withTransaction(async (tx) => {
    const lead = await repo.lockTimedOut(tx, leadId, minutes, at);
    if (!lead) return null;
    const next = await propertyAssignmentService.pickForReassignment(tx, lead.property_id, [lead.executive_id]);
    if (!next) return null; // nobody else can take it (single executive, all inactive, inactive property)
    await repo.assignTo(tx, leadId, next, at);
    await assignmentRepo.insertHistory(tx, { propertyId: lead.property_id, executiveId: next, leadId, method: 'TIMEOUT' });
    return { previousExecutiveId: lead.executive_id, expiredAssignedAt: lead.assigned_at };
  });
  if (!moved) return 'skipped';
  await publishSlaReassignment({ leadId, ...moved }); // committed: now tell the people involved
  return 'reassigned';
}

/**
 * Warns the assigned executive shortly before the SLA runs out (SLA_WARNING_MINUTES, never more than half the SLA;
 * 0 disables it). Read-only on leads: it does not touch the SLA or the reassignment, it only notifies, once per
 * assignment. Safe to run from several processes and to repeat. Returns how many warnings were sent.
 */
export async function runSlaWarningPass(limit = 500, at?: Date): Promise<number> {
  const timeoutMinutes = await settingsRepo.getLeadTimeoutMinutes();
  const warnMinutes = Math.min(env.SLA_WARNING_MINUTES, Math.floor(timeoutMinutes / 2));
  if (warnMinutes <= 0) return 0;
  const candidates = await repo.findSlaWarnable(timeoutMinutes, warnMinutes, limit, at);
  let sent = 0;
  for (const c of candidates) {
    if (await publishSlaWarning({ leadId: c.id, executiveId: c.executive_id, assignedAt: c.assigned_at, timeoutMinutes }, at)) sent++;
  }
  return sent;
}

export interface TimeoutSweepResult {
  timeoutMinutes: number;
  checked: number;
  reassigned: number;
  skipped: number;
  failed: number;
}

/**
 * One pass of the SLA check, using the admin-configured timeout. Safe to run from several processes at once.
 * It is plain elapsed time (24/7: no working hours, weekends or holidays). `at` is the moment the pass is evaluated
 * at; production never passes it (it is the database clock), tests use it to check nights, weekends and midnight.
 */
export async function runLeadTimeoutSweep(limit = 500, at?: Date): Promise<TimeoutSweepResult> {
  const timeoutMinutes = await settingsRepo.getLeadTimeoutMinutes();
  const ids = await repo.findTimedOutIds(timeoutMinutes, limit, at);
  const result: TimeoutSweepResult = { timeoutMinutes, checked: ids.length, reassigned: 0, skipped: 0, failed: 0 };
  for (const id of ids) {
    try {
      if ((await reassignTimedOutLead(id, timeoutMinutes, at)) === 'reassigned') result.reassigned++;
      else result.skipped++;
    } catch (err) {
      result.failed++; // one bad lead must not stop the others; it is retried on the next pass
      console.error('Lead timeout reassignment failed:', err instanceof Error ? err.message : err);
    }
  }
  return result;
}
