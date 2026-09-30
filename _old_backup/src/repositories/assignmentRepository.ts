import { Db, query, queryOne } from '../db/pool';
import type { LeadAssignment } from '../models/types';

export const assignmentRepository = {
  async insert(db: Db, a: { leadId: number; userId: number; teamId: number; reason: string; assignedAt: Date; slaDeadline: Date }): Promise<LeadAssignment> {
    return (await queryOne<LeadAssignment>(db,
      `INSERT INTO lead_assignments (lead_id, user_id, team_id, reason, assigned_at, sla_deadline)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [a.leadId, a.userId, a.teamId, a.reason, a.assignedAt, a.slaDeadline]))!;
  },

  findCurrent: (db: Db, leadId: number) =>
    queryOne<LeadAssignment>(db, `SELECT * FROM lead_assignments WHERE lead_id = $1 AND status IN ('ACTIVE','ATTENDED')`, [leadId]),

  previousAssigneeIds: async (db: Db, leadId: number): Promise<number[]> =>
    (await query<{ userId: number }>(db, `SELECT DISTINCT user_id FROM lead_assignments WHERE lead_id = $1`, [leadId])).map((r) => r.userId),

  listByLead: (db: Db, leadId: number) =>
    query(db,
      `SELECT a.*, u.name AS user_name FROM lead_assignments a JOIN users u ON u.id = a.user_id
       WHERE a.lead_id = $1 ORDER BY a.id`, [leadId]),

  async markAttended(db: Db, leadId: number) {
    await db.query(`UPDATE lead_assignments SET status = 'ATTENDED', attended_at = now() WHERE lead_id = $1 AND status = 'ACTIVE'`, [leadId]);
  },

  async expire(db: Db, id: number) {
    await db.query(`UPDATE lead_assignments SET status = 'SLA_EXPIRED', ended_at = now() WHERE id = $1`, [id]);
  },

  /** Lead was closed/invalidated before anyone attended it. */
  async releaseActive(db: Db, leadId: number) {
    await db.query(`UPDATE lead_assignments SET status = 'RELEASED', ended_at = now() WHERE lead_id = $1 AND status = 'ACTIVE'`, [leadId]);
  },

  /** Ends whatever assignment is current (manual reassignment). */
  async endCurrent(db: Db, leadId: number) {
    await db.query(`UPDATE lead_assignments SET status = 'RELEASED', ended_at = now() WHERE lead_id = $1 AND status IN ('ACTIVE','ATTENDED')`, [leadId]);
  },

  lockActiveByLead: (db: Db, leadId: number) =>
    queryOne<{ id: number; leadId: number; userId: number }>(db,
      `SELECT id, lead_id, user_id FROM lead_assignments WHERE lead_id = $1 AND status = 'ACTIVE' FOR UPDATE`, [leadId]),

  /**
   * Oldest ACTIVE assignment past its deadline whose lead is still unattended. SKIP LOCKED lets several
   * workers (or overlapping ticks) run safely: each grabs a different row, nobody blocks or double-processes.
   */
  lockNextExpired: (db: Db) =>
    queryOne<{ id: number; leadId: number; userId: number }>(db,
      `SELECT a.id, a.lead_id, a.user_id FROM lead_assignments a
       JOIN leads l ON l.id = a.lead_id
       WHERE a.status = 'ACTIVE' AND a.sla_deadline <= now() AND l.contacted_at IS NULL AND l.deleted_at IS NULL
       ORDER BY a.sla_deadline LIMIT 1 FOR UPDATE OF a, l SKIP LOCKED`),

  /** Atomically claims assignments entering the warning window (single UPDATE = safe under concurrency). */
  claimSlaWarnings: (db: Db, warningMinutes: number) =>
    query<{ id: number; leadId: number; userId: number; slaDeadline: Date }>(db,
      `UPDATE lead_assignments SET sla_warning_sent_at = now()
       WHERE status = 'ACTIVE' AND sla_warning_sent_at IS NULL AND sla_deadline > now()
         AND sla_deadline <= now() + make_interval(mins => $1::int)
       RETURNING id, lead_id, user_id, sla_deadline`, [warningMinutes]),
};
