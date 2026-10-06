import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import type { Db } from '../../database/transaction';
import { escapeLike } from '../teams/team.repository';
import type { PropertySource } from '../properties/property.model';
import type { LeadRow, LeadStatus } from './lead.model';

export const LEAD_EXTERNAL_UNIQUE = 'leads_source_external_lead_id_key';

/** `viewer` is a SQL parameter holding the logged-in user's id: is_important is that user's own flag. */
const IMPORTANT = (viewer: string) =>
  `EXISTS (SELECT 1 FROM lead_important li WHERE li.lead_id = l.id AND li.user_id = ${viewer}::uuid)`;

const select = (viewer: string) => `
  SELECT ${IMPORTANT(viewer)} AS is_important, l.id, l.lead_no, l.status, l.message, l.requirement, l.assigned_at, l.seen_at, l.budget, l.property_name AS requested_property_name, l.external_lead_id, l.source, l.created_at, l.updated_at,
         c.id AS customer_id, c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email, c.type AS customer_type,
         p.id AS property_id, p.name AS property_name, p.location AS property_location,
         u.id AS executive_id, u.name AS executive_name
  FROM leads l
  JOIN customers c ON c.id = l.customer_id
  JOIN properties p ON p.id = l.property_id
  LEFT JOIN users u ON u.id = l.assigned_executive_id`;

/**
 * A manager sees the leads of the sales users in the teams they lead, plus leads nobody has been assigned yet
 * (so they can pick an executive from their team for them).
 */
const managerScope = (param: string) =>
  `(l.status = 'PENDING_ASSIGNMENT' OR l.assigned_executive_id IN (
      SELECT u.id FROM users u JOIN teams t ON t.id = u.team_id WHERE t.manager_id = ${param}))`;

/** `ownerId` scopes the lookup to one executive's leads, `managerId` to one manager's scope (others look like "not found"). */
export async function findById(id: string, ownerId?: string, managerId?: string, viewerId?: string): Promise<LeadRow | null> {
  const params: unknown[] = [id];
  let sql = `${select(`$${params.push(viewerId ?? null)}`)} WHERE l.id = $1`;
  if (ownerId) sql += ` AND l.assigned_executive_id = $${params.push(ownerId)}`;
  if (managerId) sql += ` AND ${managerScope(`$${params.push(managerId)}`)}`;
  return (await pool.query<LeadRow>(sql, params)).rows[0] ?? null;
}

export async function findByExternalId(
  source: PropertySource,
  externalLeadId: string,
  viewerId?: string,
): Promise<LeadRow | null> {
  return (
    (
      await pool.query<LeadRow>(`${select('$3')} WHERE l.source = $1 AND l.external_lead_id = $2`, [
        source,
        externalLeadId,
        viewerId ?? null,
      ])
    ).rows[0] ?? null
  );
}

export interface LeadFilters {
  status?: LeadStatus;
  propertyId?: string;
  executiveId?: string;
  /** A manager's view: their teams' leads plus unassigned ones. */
  managerId?: string;
  customerId?: string;
  search?: string;
  /** Only leads assigned to an executive that they have not opened yet. */
  isNew?: boolean;
  /** Only leads assigned after this instant (for polling: pass the last assignedAt you saw). */
  assignedSince?: string;
  /** Executive's view: unopened leads first, then most recently assigned. */
  forExecutive?: boolean;
  /** The logged-in user: is_important is their own flag. */
  viewerId?: string;
  /** Only leads the viewer marked important (true) or did not (false). */
  important?: boolean;
  limit: number;
  offset: number;
}

export async function list(f: LeadFilters): Promise<LeadRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const viewer = `$${params.push(f.viewerId ?? null)}`;
  if (f.important !== undefined) where.push(f.important ? IMPORTANT(viewer) : `NOT ${IMPORTANT(viewer)}`);
  if (f.status) where.push(`l.status = $${params.push(f.status)}`);
  if (f.propertyId) where.push(`l.property_id = $${params.push(f.propertyId)}`);
  if (f.executiveId) where.push(`l.assigned_executive_id = $${params.push(f.executiveId)}`);
  if (f.managerId) where.push(managerScope(`$${params.push(f.managerId)}`));
  if (f.customerId) where.push(`l.customer_id = $${params.push(f.customerId)}`);
  if (f.isNew) where.push('(l.assigned_executive_id IS NOT NULL AND l.seen_at IS NULL)');
  // ms precision: the API returns assignedAt in ms, the column holds microseconds, so compare like with like.
  if (f.assignedSince) where.push(`date_trunc('milliseconds', l.assigned_at) > $${params.push(f.assignedSince)}::timestamptz`);
  if (f.search) {
    const s = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(c.name ILIKE ${s} OR c.mobile ILIKE ${s} OR c.email ILIKE ${s} OR p.name ILIKE ${s})`);
  }
  const lim = `$${params.push(f.limit)}`;
  const off = `$${params.push(f.offset)}`;
  const sql = `${select(viewer)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY ${
                 f.forExecutive
                   ? '(l.assigned_executive_id IS NOT NULL AND l.seen_at IS NULL) DESC, l.assigned_at DESC NULLS LAST, l.created_at DESC'
                   : 'l.created_at DESC'
               }, l.id LIMIT ${lim} OFFSET ${off}`;
  return (await pool.query<LeadRow>(sql, params)).rows;
}

export async function insert(
  db: Db,
  l: {
    customerId: string;
    propertyId: string;
    source: PropertySource;
    message: string | null;
    requirement: string | null;
    budget: number | null;
    propertyName: string;
    externalLeadId: string | null;
    rawPayload: unknown;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO leads (customer_id, property_id, source, status, message, requirement, budget, property_name, external_lead_id, raw_payload)
     VALUES ($1, $2, $3, 'PENDING_ASSIGNMENT', $4, $5, $6, $7, $8, $9) RETURNING id`,
    [l.customerId, l.propertyId, l.source, l.message, l.requirement, l.budget, l.propertyName, l.externalLeadId, l.rawPayload ?? null],
  );
  return rows[0].id;
}

/** Giving a lead its executive is what takes it out of PENDING_ASSIGNMENT. */
export const markAssigned = async (db: Db, leadId: string, executiveId: string): Promise<void> => {
  await db.query("UPDATE leads SET assigned_executive_id = $2, status = 'INCOMING', assigned_at = now(), seen_at = NULL WHERE id = $1", [leadId, executiveId]);
};

/** Oldest first, locked so two concurrent "assign executives" calls cannot both pick the same lead. */
export async function lockPendingIds(db: Db, propertyId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM leads WHERE property_id = $1 AND status = 'PENDING_ASSIGNMENT'
     ORDER BY created_at, id FOR UPDATE`,
    [propertyId],
  );
  return rows.map((r) => r.id);
}

export const setStatus = (id: string, status: LeadStatus) => patchRow('leads', id, { status });

/** The executive opened the lead: the "New" indicator goes away. Only the first open counts. */
export const markSeen = async (id: string, executiveId: string): Promise<void> => {
  await pool.query(
    'UPDATE leads SET seen_at = now() WHERE id = $1 AND assigned_executive_id = $2 AND seen_at IS NULL',
    [id, executiveId],
  );
};

/** Every other enquiry the same client made, newest first (the client's history). */
export async function listForCustomer(
  customerId: string,
  excludeLeadId: string,
  limit = 50,
  viewerId?: string,
): Promise<LeadRow[]> {
  return (
    await pool.query<LeadRow>(
      `${select('$4')} WHERE l.customer_id = $1 AND l.id <> $2 ORDER BY l.created_at DESC, l.id LIMIT $3`,
      [customerId, excludeLeadId, limit, viewerId ?? null],
    )
  ).rows;
}

export async function summaryFor(executiveId: string) {
  const { rows } = await pool.query<{ status: LeadStatus; total: number; unseen: number }>(
    `SELECT status, count(*)::int AS total, count(*) FILTER (WHERE seen_at IS NULL)::int AS unseen
     FROM leads WHERE assigned_executive_id = $1 GROUP BY status`,
    [executiveId],
  );
  return rows;
}

/**
 * An admin/manager gives the lead to a specific executive. The executive sees it as new (assigned_at/seen_at are
 * reset). A lead that was pending starts its pipeline at INCOMING; any other status is kept.
 */
export const assignTo = async (db: Db, leadId: string, executiveId: string, at?: Date): Promise<void> => {
  await db.query(
    `UPDATE leads
     SET assigned_executive_id = $2, assigned_at = COALESCE($3::timestamptz, now()), seen_at = NULL,
         status = CASE WHEN status = 'PENDING_ASSIGNMENT' THEN 'INCOMING'::lead_status ELSE status END
     WHERE id = $1`,
    [leadId, executiveId, at ?? null],
  );
};

/** Idempotent: marking a lead that is already important changes nothing. */
export const markImportant = async (userId: string, leadId: string): Promise<void> => {
  await pool.query('INSERT INTO lead_important (user_id, lead_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, leadId]);
};
export const unmarkImportant = async (userId: string, leadId: string): Promise<void> => {
  await pool.query('DELETE FROM lead_important WHERE user_id = $1 AND lead_id = $2', [userId, leadId]);
};

/**
 * Leads that are assigned, still INCOMING (nobody handled them) and were assigned at least `minutes` ago, oldest
 * first. Only a candidate list: every lead is re-checked under a row lock before it is touched (lockTimedOut).
 */
export async function findTimedOutIds(minutes: number, limit: number, at?: Date): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM leads
     WHERE status = 'INCOMING' AND assigned_executive_id IS NOT NULL
       AND assigned_at <= COALESCE($3::timestamptz, now()) - make_interval(mins => $1)
     ORDER BY assigned_at, id LIMIT $2`,
    [minutes, limit, at ?? null],
  );
  return rows.map((r) => r.id);
}

/**
 * Locks one lead for a timeout reassignment, re-checking that it is STILL timed out. Returns null if it was
 * handled, reassigned (assigned_at moved), or is being worked on by another transaction right now (SKIP LOCKED).
 * This is what guarantees a lead is never reassigned twice for the same timeout, even with concurrent sweeps.
 */
export async function lockTimedOut(
  db: Db,
  id: string,
  minutes: number,
  at?: Date,
): Promise<{ property_id: string; executive_id: string } | null> {
  const { rows } = await db.query<{ property_id: string; executive_id: string }>(
    `SELECT property_id, assigned_executive_id AS executive_id FROM leads
     WHERE id = $1 AND status = 'INCOMING' AND assigned_executive_id IS NOT NULL
       AND assigned_at <= COALESCE($3::timestamptz, now()) - make_interval(mins => $2)
     FOR UPDATE SKIP LOCKED`,
    [id, minutes, at ?? null],
  );
  return rows[0] ?? null;
}
