import type { Db } from '../../database/transaction';
import * as settingsRepo from '../settings/settings.repository';
import * as repo from './lead-activity.repository';
import type { ActivityRow } from './lead-activity.repository';
import type { LeadStatus } from './lead.model';

/** Writes the timeline entries for a lead change, inside the transaction that makes the change. They return the rows so the caller can announce them after the commit. */

const nameOf = async (db: Db, id: string | null | undefined): Promise<string> =>
  id ? ((await db.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [id])).rows[0]?.name ?? 'an executive') : 'the system';

const title = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export async function recordReceived(db: Db, leadId: string, source: string, actorId?: string): Promise<ActivityRow> {
  return repo.add(db, { leadId, type: 'LEAD_RECEIVED', message: `Lead received from ${source}`, actorId });
}

export type AssignHow = 'ROUND_ROBIN' | 'PENDING_ASSIGNED' | 'MANUAL';

/** The lead now belongs to `executiveId`: who gave it, and the start of that executive's SLA. */
export async function recordAssigned(db: Db, a: { leadId: string; executiveId: string; how: AssignHow; byId?: string }): Promise<ActivityRow[]> {
  const name = await nameOf(db, a.executiveId);
  const how =
    a.how === 'MANUAL' ? `by ${await nameOf(db, a.byId)}` : a.how === 'ROUND_ROBIN' ? '(Round Robin)' : '(property executives were set)';
  const assigned = await repo.add(db, { leadId: a.leadId, type: 'ASSIGNED', message: `Assigned to ${name} ${how}`, actorId: a.byId, executiveId: a.executiveId });
  const sla = await slaStarted(db, a.leadId, a.executiveId);
  return [assigned, sla];
}

const slaStarted = async (db: Db, leadId: string, executiveId: string) =>
  repo.add(db, { leadId, type: 'SLA_STARTED', message: `${await settingsRepo.getLeadTimeoutMinutes(db)} min SLA started`, executiveId });

/** The SLA ran out and the lead moved on: the breach, the new owner, and the new owner's SLA. */
export async function recordTimeout(db: Db, a: { leadId: string; previousExecutiveId: string; executiveId: string }): Promise<ActivityRow[]> {
  const breached = await repo.add(db, { leadId: a.leadId, type: 'SLA_BREACHED', message: 'SLA breached — marked Overdue', executiveId: a.previousExecutiveId });
  const moved = await repo.add(db, {
    leadId: a.leadId,
    type: 'AUTO_REASSIGNED',
    message: `Auto-reassigned to ${await nameOf(db, a.executiveId)} after SLA breach`,
    executiveId: a.executiveId,
  });
  return [breached, moved, await slaStarted(db, a.leadId, a.executiveId)];
}

export async function recordStatus(db: Db, a: { leadId: string; status: LeadStatus; actorId?: string; executiveId?: string | null }): Promise<ActivityRow> {
  return repo.add(db, {
    leadId: a.leadId,
    type: 'STATUS_CHANGED',
    message: `Status changed to ${title(a.status)}${a.actorId ? ` by ${await nameOf(db, a.actorId)}` : ''}`,
    actorId: a.actorId,
    executiveId: a.executiveId,
  });
}
