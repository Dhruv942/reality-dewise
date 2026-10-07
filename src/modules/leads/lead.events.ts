import { pool } from '../../database/pool';
import { emitTo, rooms } from '../../realtime/socket';
import { notify } from '../notifications/notification.service';
import type { NotificationType } from '../notifications/notification.model';
import * as repo from './lead.repository';
import { toLeadDto, type LeadRow, type LeadStatus } from './lead.model';

/**
 * Real-time + in-app notifications for lead events. Every function here is called AFTER the business change
 * has committed and only reports what actually happened: it never decides anything and never throws (a failed
 * push must not turn a successful request or sweep into an error; the REST data is already correct).
 *
 * Who hears about a lead mirrors who can see it over REST:
 *   admin                -> every lead                              (room "admin")
 *   the assigned sales   -> their own leads                         (room "executive:<id>")
 *   managers             -> leads of their teams, and unassigned    (rooms "manager:<id>" / "managers")
 * The previous executive of a moved lead only gets a minimal payload (no customer details): they can no longer see it.
 */

async function safely(what: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`Realtime ${what} failed:`, err instanceof Error ? err.message : err);
  }
}

/** The lead as REST shows it to a non-owner: isImportant is a per-user flag, so it is never broadcast. */
const leadPayload = (row: LeadRow) => {
  const { isImportant: _flag, ...lead } = toLeadDto(row);
  return lead;
};

const emit = (event: string, to: string[], payload: unknown) => {
  const leadId = (payload as { leadId?: string }).leadId;
  emitTo(event, to, payload, leadId ? `lead=${leadId}` : '');
};

/** Managers leading the team of any of these executives. */
async function managersOf(executiveIds: (string | null | undefined)[]): Promise<string[]> {
  const ids = executiveIds.filter((id): id is string => !!id);
  if (ids.length === 0) return [];
  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT m.id FROM users u
     JOIN teams t ON t.id = u.team_id
     JOIN users m ON m.id = t.manager_id AND m.is_active AND m.deleted_at IS NULL
     WHERE u.id = ANY($1::uuid[])`,
    [ids],
  );
  return rows.map((r) => r.id);
}

const activeUserIds = async (role: 'ADMIN' | 'MANAGER'): Promise<string[]> =>
  (await pool.query<{ id: string }>("SELECT id FROM users WHERE role = $1 AND is_active AND deleted_at IS NULL", [role])).rows.map((r) => r.id);

async function notifyAll(
  userIds: string[],
  n: { type: NotificationType; title: string; message: string; leadId: string; dedupeKey: string },
): Promise<void> {
  for (const userId of new Set(userIds)) {
    await notify({ userId, type: n.type, title: n.title, message: n.message, entityType: 'LEAD', entityId: n.leadId, dedupeKey: n.dedupeKey });
  }
}

const label = (row: LeadRow) => `Lead #${row.lead_no} (${row.property_name})`;

/** A lead was just created (and, when a property executive was available, already assigned by round-robin). */
export const publishLeadCreated = (leadId: string) =>
  safely('lead:created', async () => {
    const row = await repo.findById(leadId);
    if (!row) return;
    const pending = row.executive_id === null;
    const managers = pending ? [] : await managersOf([row.executive_id]);
    emit('lead:created', [rooms.admin, ...(pending ? [rooms.managers] : [rooms.executive(row.executive_id!), ...managers.map(rooms.manager)])], { leadId, lead: leadPayload(row) });

    if (pending) {
      // Nobody could take it: admins and managers have to act, so they get a notification.
      await notifyAll([...(await activeUserIds('ADMIN')), ...(await activeUserIds('MANAGER'))], {
        type: 'LEAD_CREATED',
        title: 'New Lead Needs Assignment',
        message: `${label(row)} is waiting for an executive. Assign an executive to its property or assign it directly.`,
        leadId,
        dedupeKey: `lead-created:${leadId}`,
      });
    } else {
      await publishAssignment({ leadId, previousExecutiveId: null, reason: 'CREATED' }, row);
    }
  });

export type AssignmentReason = 'CREATED' | 'PENDING_ASSIGNED' | 'MANUAL' | 'SLA_TIMEOUT';

/**
 * The lead now belongs to a (new) executive. `lead:assigned` for a first assignment, `lead:reassigned` when it
 * moved from another executive (by an admin/manager, or by the SLA).
 */
export const publishAssignment = (
  a: { leadId: string; previousExecutiveId: string | null; reason: AssignmentReason },
  loaded?: LeadRow,
) =>
  safely('lead assignment', async () => {
    const row = loaded ?? (await repo.findById(a.leadId));
    if (!row?.executive_id || !row.assigned_at) return;
    const executiveId = row.executive_id;
    const previous = a.previousExecutiveId && a.previousExecutiveId !== executiveId ? a.previousExecutiveId : null;
    const event = previous ? 'lead:reassigned' : 'lead:assigned';
    const managers = await managersOf([executiveId, previous]);
    const payload = { leadId: a.leadId, lead: leadPayload(row), executiveId, previousExecutiveId: previous, reason: a.reason };

    emit(event, [rooms.admin, rooms.executive(executiveId), ...managers.map(rooms.manager)], payload);
    if (previous) emit(event, [rooms.executive(previous)], { leadId: a.leadId, executiveId, previousExecutiveId: previous, reason: a.reason });

    // The same assignment (same lead, executive and assigned_at) can only notify once, whatever retries.
    const key = `${row.id}:${executiveId}:${row.assigned_at.getTime()}`;
    await notify({
      userId: executiveId,
      type: previous ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED',
      title: previous ? 'Lead Reassigned To You' : 'New Lead Assigned',
      message: previous ? `${label(row)} has been reassigned to you.` : `${label(row)} has been assigned to you.`,
      entityType: 'LEAD',
      entityId: a.leadId,
      dedupeKey: `lead-assigned:${key}`,
    });
    if (previous && a.reason === 'MANUAL') {
      await notify({
        userId: previous,
        type: 'LEAD_REASSIGNED',
        title: 'Lead Reassigned',
        message: `${label(row)} has been reassigned to another executive.`,
        entityType: 'LEAD',
        entityId: a.leadId,
        dedupeKey: `lead-reassigned-away:${key}`,
      });
    }
    if (previous && a.reason === 'SLA_TIMEOUT') {
      // Admins and the managers in scope are told the SLA moved a lead; the previous executive got SLA_EXPIRED.
      await notifyAll([...(await activeUserIds('ADMIN')), ...managers], {
        type: 'LEAD_REASSIGNED',
        title: 'Lead Reassigned (SLA)',
        message: `${label(row)} was not handled in time and has been reassigned.`,
        leadId: a.leadId,
        dedupeKey: `lead-reassigned-sla:${key}`,
      });
    }
  });

/** The SLA ran out and the existing sweep moved the lead. Emits sla-expired, then the reassignment. */
export const publishSlaReassignment = (a: { leadId: string; previousExecutiveId: string; expiredAssignedAt: Date }) =>
  safely('lead:sla-expired', async () => {
    const row = await repo.findById(a.leadId);
    if (!row) return;
    const managers = await managersOf([a.previousExecutiveId]);
    emit('lead:sla-expired', [rooms.admin, rooms.executive(a.previousExecutiveId), ...managers.map(rooms.manager)], {
      leadId: a.leadId,
      executiveId: a.previousExecutiveId,
      assignedAt: a.expiredAssignedAt,
    });
    await notify({
      userId: a.previousExecutiveId,
      type: 'SLA_EXPIRED',
      title: 'Lead SLA Expired',
      message: `${label(row)} was not handled in time and has been taken from you.`,
      entityType: 'LEAD',
      entityId: a.leadId,
      dedupeKey: `sla-expired:${a.leadId}:${a.expiredAssignedAt.getTime()}`,
    });
    await publishAssignment({ leadId: a.leadId, previousExecutiveId: a.previousExecutiveId, reason: 'SLA_TIMEOUT' }, row);
  });

/** The assigned executive's SLA is about to run out. Once per assignment: a re-run of the job changes nothing. */
export async function publishSlaWarning(w: { leadId: string; executiveId: string; assignedAt: Date; timeoutMinutes: number }, now = new Date()): Promise<boolean> {
  let sent = false;
  await safely('lead:sla-warning', async () => {
    const row = await repo.findById(w.leadId);
    if (!row) return;
    const expiresAt = new Date(w.assignedAt.getTime() + w.timeoutMinutes * 60_000);
    const remainingSeconds = Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
    const created = await notify({
      userId: w.executiveId,
      type: 'SLA_WARNING',
      title: 'Lead SLA Running Out',
      message: `${label(row)} will be reassigned in about ${Math.max(1, Math.ceil(remainingSeconds / 60))} minute(s) unless you handle it.`,
      entityType: 'LEAD',
      entityId: w.leadId,
      dedupeKey: `sla-warning:${w.leadId}:${w.assignedAt.getTime()}`,
    });
    if (!created) return; // already warned for this assignment
    sent = true;
    const managers = await managersOf([w.executiveId]);
    emit('lead:sla-warning', [rooms.admin, rooms.executive(w.executiveId), ...managers.map(rooms.manager)], {
      leadId: w.leadId,
      executiveId: w.executiveId,
      expiresAt,
      remainingSeconds,
    });
  });
  return sent;
}

/** A person changed the status of a lead. `actorId` is who did it (the assigned executive is told if it was someone else). */
export const publishStatusUpdated = (s: { leadId: string; previousStatus: LeadStatus; actorId?: string }) =>
  safely('lead:status-updated', async () => {
    const row = await repo.findById(s.leadId);
    if (!row || row.status === s.previousStatus) return;
    const managers = await managersOf([row.executive_id]);
    emit('lead:status-updated', [rooms.admin, ...(row.executive_id ? [rooms.executive(row.executive_id)] : []), ...managers.map(rooms.manager)], {
      leadId: s.leadId,
      status: row.status,
      previousStatus: s.previousStatus,
      lead: leadPayload(row),
    });
    if (row.executive_id && row.executive_id !== s.actorId) {
      await notify({
        userId: row.executive_id,
        type: 'LEAD_STATUS_UPDATED',
        title: 'Lead Status Updated',
        message: `${label(row)} was moved to ${row.status}.`,
        entityType: 'LEAD',
        entityId: s.leadId,
        dedupeKey: `lead-status:${s.leadId}:${row.status}:${row.updated_at.getTime()}`,
      });
    }
  });
