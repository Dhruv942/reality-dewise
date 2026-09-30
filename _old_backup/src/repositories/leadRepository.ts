import { Db, insertRow, query, queryOne } from '../db/pool';
import type { Lead, LeadStatus, LockedLead } from '../models/types';
import { Pagination, offsetOf } from '../utils/pagination';
import { LeadFilters, buildLeadWhere } from './leadFilters';

const DETAIL_SELECT = `
  SELECT l.*, c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email, p.name AS project_name, u.name AS assignee_name
  FROM leads l
  JOIN customers c ON c.id = l.customer_id
  JOIN projects p ON p.id = l.project_id
  LEFT JOIN users u ON u.id = l.assigned_to`;

export const leadRepository = {
  /** Idempotent on (source, external_id): returns null when the portal lead was already ingested. */
  async insertIgnoreDuplicate(db: Db, d: {
    customerId: number; projectId: number; propertyId?: number; enquiryId?: number; source: string;
    externalId?: string; requirement?: string; budget?: number; metadata?: Record<string, unknown>;
  }): Promise<Lead | null> {
    return queryOne<Lead>(db,
      `INSERT INTO leads (customer_id, project_id, property_id, enquiry_id, source, external_id, requirement, budget, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING *`,
      [d.customerId, d.projectId, d.propertyId ?? null, d.enquiryId ?? null, d.source, d.externalId ?? null, d.requirement ?? null, d.budget ?? null, JSON.stringify(d.metadata ?? {})]);
  },

  findBySourceExternal: (db: Db, source: string, externalId: string) =>
    queryOne<Lead>(db, `SELECT * FROM leads WHERE source = $1 AND external_id = $2`, [source, externalId]),

  findById: (db: Db, id: number) => queryOne<Lead>(db, `SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL`, [id]),

  findDetail: (db: Db, id: number) =>
    queryOne<Lead & { customerName: string; customerMobile: string; customerEmail: string | null; projectName: string; assigneeName: string | null }>(
      db, `${DETAIL_SELECT} WHERE l.id = $1 AND l.deleted_at IS NULL`, [id]),

  lockById: (db: Db, id: number) =>
    queryOne<Lead>(db, `SELECT * FROM leads WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]),

  lockWithProject: (db: Db, id: number) =>
    queryOne<LockedLead>(db,
      `SELECT l.*, p.team_id AS project_team_id, p.sla_minutes AS project_sla_minutes
       FROM leads l JOIN projects p ON p.id = l.project_id
       WHERE l.id = $1 AND l.deleted_at IS NULL FOR UPDATE OF l`, [id]),

  list(db: Db, f: LeadFilters, p: Pagination) {
    const params: unknown[] = [];
    const where = buildLeadWhere(f, params);
    params.push(p.limit, offsetOf(p));
    return query<any>(db,
      `SELECT l.*, c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email, p.name AS project_name, u.name AS assignee_name,
              count(*) OVER () AS total_count
       FROM leads l JOIN customers c ON c.id = l.customer_id JOIN projects p ON p.id = l.project_id
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE ${where} ORDER BY l.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  },

  /** Points the lead at a new executive and starts a fresh SLA window measured on the DB clock. */
  async applyAssignment(db: Db, id: number, userId: number, slaMinutes: number, isReassignment: boolean): Promise<Lead> {
    return (await queryOne<Lead>(db,
      `UPDATE leads SET status = 'ASSIGNED', assigned_to = $2, assigned_at = now(),
              sla_deadline = now() + make_interval(mins => $3::int), reassign_count = reassign_count + $4
       WHERE id = $1 RETURNING *`, [id, userId, slaMinutes, isReassignment ? 1 : 0]))!;
  },

  /** No eligible executive right now: lead goes back to the unassigned pool. */
  async release(db: Db, id: number): Promise<Lead> {
    return (await queryOne<Lead>(db,
      `UPDATE leads SET status = 'NEW', assigned_to = NULL, assigned_at = NULL, sla_deadline = NULL WHERE id = $1 RETURNING *`, [id]))!;
  },

  async setStatus(db: Db, id: number, status: LeadStatus): Promise<Lead> {
    return (await queryOne<Lead>(db, `UPDATE leads SET status = $2 WHERE id = $1 RETURNING *`, [id, status]))!;
  },

  async markContacted(db: Db, id: number) {
    await db.query(`UPDATE leads SET contacted_at = COALESCE(contacted_at, now()) WHERE id = $1`, [id]);
  },

  /** NEW leads that have no executive yet (retried by the job when a team had nobody available). */
  unassignedIds: async (db: Db, limit: number): Promise<number[]> =>
    (await query<{ id: number }>(db,
      `SELECT id FROM leads WHERE status = 'NEW' AND assigned_to IS NULL AND deleted_at IS NULL ORDER BY id LIMIT $1`, [limit])).map((r) => r.id),

  insertStatusHistory: (db: Db, h: { leadId: number; fromStatus: LeadStatus | null; toStatus: LeadStatus; changedBy?: number | null; reason?: string }) =>
    insertRow(db, 'lead_status_history', h),

  statusHistory: (db: Db, leadId: number) =>
    query(db,
      `SELECT h.*, u.name AS changed_by_name FROM lead_status_history h LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.lead_id = $1 ORDER BY h.id`, [leadId]),

  /** Everything we know about a customer's earlier interactions, for duplicate/repeat-customer display. */
  previousLeads: (db: Db, customerId: number) =>
    query(db,
      `SELECT l.id, l.source, l.status, l.requirement, l.budget, l.created_at, p.name AS project_name
       FROM leads l JOIN projects p ON p.id = l.project_id
       WHERE l.customer_id = $1 AND l.deleted_at IS NULL ORDER BY l.id DESC`, [customerId]),

  previousEnquiries: (db: Db, mobile: string) =>
    query(db,
      `SELECT id, requirement, budget, status, created_at FROM enquiries
       WHERE mobile = $1 AND deleted_at IS NULL ORDER BY id DESC`, [mobile]),
};
