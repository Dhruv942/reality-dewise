import { Db, insertRow, query, queryOne } from '../db/pool';
import type { FollowUp } from '../models/types';
import { Pagination, offsetOf } from '../utils/pagination';

export const followUpRepository = {
  insert: (db: Db, f: { leadId: number; assignedTo?: number | null; scheduledAt: Date; notes?: string | null }) =>
    insertRow<FollowUp>(db, 'follow_ups', f),

  lockById: (db: Db, id: number) => queryOne<FollowUp>(db, `SELECT * FROM follow_ups WHERE id = $1 FOR UPDATE`, [id]),

  findById: (db: Db, id: number) => queryOne<FollowUp>(db, `SELECT * FROM follow_ups WHERE id = $1`, [id]),

  listByLead: (db: Db, leadId: number) =>
    query<FollowUp>(db, `SELECT * FROM follow_ups WHERE lead_id = $1 ORDER BY scheduled_at`, [leadId]),

  list: (db: Db, f: { status?: string; assignedTo?: number; from?: Date; to?: Date }, p: Pagination) =>
    query<any>(db,
      `SELECT f.*, count(*) OVER () AS total_count FROM follow_ups f
       WHERE ($1::follow_up_status IS NULL OR f.status = $1) AND ($2::bigint IS NULL OR f.assigned_to = $2)
         AND ($3::timestamptz IS NULL OR f.scheduled_at >= $3) AND ($4::timestamptz IS NULL OR f.scheduled_at <= $4)
       ORDER BY f.scheduled_at LIMIT $5 OFFSET $6`,
      [f.status ?? null, f.assignedTo ?? null, f.from ?? null, f.to ?? null, p.limit, offsetOf(p)]),

  update: (db: Db, id: number, set: { status?: string; scheduledAt?: Date; notes?: string | null }) =>
    queryOne<FollowUp>(db,
      `UPDATE follow_ups SET
         status = COALESCE($2::follow_up_status, status),
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END,
         scheduled_at = COALESCE($3, scheduled_at),
         reminder_sent_at = CASE WHEN $3::timestamptz IS NOT NULL THEN NULL ELSE reminder_sent_at END,
         notes = COALESCE($4, notes)
       WHERE id = $1 RETURNING *`, [id, set.status ?? null, set.scheduledAt ?? null, set.notes ?? null]),

  async completeDue(db: Db, leadId: number) {
    await db.query(
      `UPDATE follow_ups SET status = 'COMPLETED', completed_at = now()
       WHERE lead_id = $1 AND status IN ('PENDING','MISSED') AND scheduled_at <= now()`, [leadId]);
  },

  async cancelOpen(db: Db, leadId: number) {
    await db.query(`UPDATE follow_ups SET status = 'CANCELLED' WHERE lead_id = $1 AND status IN ('PENDING','MISSED')`, [leadId]);
  },

  /** Atomically claims reminders that are due within the reminder window. */
  claimReminders: (db: Db, reminderMinutes: number) =>
    query<{ id: number; leadId: number; assignedTo: number | null; scheduledAt: Date }>(db,
      `UPDATE follow_ups SET reminder_sent_at = now()
       WHERE status = 'PENDING' AND reminder_sent_at IS NULL AND assigned_to IS NOT NULL
         AND scheduled_at <= now() + make_interval(mins => $1::int)
       RETURNING id, lead_id, assigned_to, scheduled_at`, [reminderMinutes]),

  async markMissed(db: Db, graceMinutes: number): Promise<number> {
    const res = await db.query(
      `UPDATE follow_ups SET status = 'MISSED'
       WHERE status = 'PENDING' AND scheduled_at < now() - make_interval(mins => $1::int)`, [graceMinutes]);
    return res.rowCount ?? 0;
  },
};
