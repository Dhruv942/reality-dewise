import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';

export const ACTIVITY_TYPES = ['LEAD_RECEIVED', 'ASSIGNED', 'SLA_STARTED', 'STATUS_CHANGED', 'SLA_BREACHED', 'AUTO_REASSIGNED'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface ActivityRow {
  id: string;
  seq: string;
  lead_id: string;
  type: ActivityType;
  message: string;
  actor_id: string | null;
  actor_name: string | null;
  executive_id: string | null;
  created_at: Date;
}

export const toActivityDto = (a: ActivityRow) => ({
  id: a.id,
  type: a.type,
  message: a.message,
  actor: a.actor_id ? { id: a.actor_id, name: a.actor_name } : null,
  executiveId: a.executive_id,
  createdAt: a.created_at,
});

/** Always called with the transaction that makes the change, so the timeline can never disagree with the lead. */
export async function add(
  db: Db,
  a: { leadId: string; type: ActivityType; message: string; actorId?: string | null; executiveId?: string | null },
): Promise<ActivityRow> {
  const { rows } = await db.query<ActivityRow>(
    `WITH i AS (
       INSERT INTO lead_activities (lead_id, type, message, actor_id, executive_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *
     )
     SELECT i.*, u.name AS actor_name FROM i LEFT JOIN users u ON u.id = i.actor_id`,
    [a.leadId, a.type, a.message, a.actorId ?? null, a.executiveId ?? null],
  );
  return rows[0];
}

export async function listForLead(leadId: string): Promise<ActivityRow[]> {
  const { rows } = await pool.query<ActivityRow>(
    `SELECT a.*, u.name AS actor_name FROM lead_activities a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.lead_id = $1 ORDER BY a.seq`,
    [leadId],
  );
  return rows;
}
