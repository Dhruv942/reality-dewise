import type { Db } from '../../database/transaction';
import { pool } from '../../database/pool';
import type { AssignmentHistoryRow, AssignmentMethod } from './assignment.model';

export const HISTORY_LEAD_UNIQUE = 'property_assignment_history_lead_id_key';

export interface PropertyForAssignment {
  id: string;
  name: string;
  is_active: boolean;
}

/** FOR SHARE: admin edits to the property wait until the in-flight assignment commits. */
export async function lockProperty(db: Db, id: string): Promise<PropertyForAssignment | null> {
  const { rows } = await db.query<PropertyForAssignment>(
    'SELECT id, name, is_active FROM properties WHERE id = $1 FOR SHARE',
    [id],
  );
  return rows[0] ?? null;
}

export async function findHistoryByLead(db: Db, leadId: string): Promise<AssignmentHistoryRow | null> {
  const { rows } = await db.query<AssignmentHistoryRow>(
    "SELECT * FROM property_assignment_history WHERE lead_id = $1 AND method = 'ROUND_ROBIN'",
    [leadId],
  );
  return rows[0] ?? null;
}

/** Creates the property's state row if needed, then locks it. Serialises round-robin per property. */
export async function lockPropertyState(db: Db, propertyId: string): Promise<string | null> {
  await db.query('INSERT INTO property_assignment_state (property_id) VALUES ($1) ON CONFLICT DO NOTHING', [propertyId]);
  const { rows } = await db.query<{ last_assigned_executive_id: string | null }>(
    'SELECT last_assigned_executive_id FROM property_assignment_state WHERE property_id = $1 FOR UPDATE',
    [propertyId],
  );
  return rows[0].last_assigned_executive_id;
}

export const setLastAssigned = (db: Db, propertyId: string, executiveId: string) =>
  db.query(
    'UPDATE property_assignment_state SET last_assigned_executive_id = $2, updated_at = now() WHERE property_id = $1',
    [propertyId, executiveId],
  );

/**
 * The executives hand-picked for the property, in a stable rotation order (created_at, id), each flagged
 * with whether it sorts after the last assigned executive. The last executive is looked up by id whatever
 * its current status or list membership, so the pointer survives them being deactivated or removed.
 */
export async function listRotation(db: Db, propertyId: string, lastId: string | null) {
  const { rows } = await db.query<{ id: string; after_last: boolean | null }>(
    `SELECT u.id,
            (u.created_at, u.id) > (SELECT l.created_at, l.id FROM users l WHERE l.id = $2::uuid) AS after_last
     FROM property_executives pe
     JOIN users u ON u.id = pe.executive_id
     WHERE pe.property_id = $1 AND u.role = 'SALES' AND u.deleted_at IS NULL
     ORDER BY u.created_at, u.id`,
    [propertyId, lastId],
  );
  return rows.map((r) => ({ id: r.id, afterLast: r.after_last === true }));
}

export async function insertHistory(
  db: Db,
  h: { propertyId: string; executiveId: string; leadId: string; method?: AssignmentMethod; assignedById?: string },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property_assignment_history (property_id, executive_id, lead_id, method, assigned_by_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [h.propertyId, h.executiveId, h.leadId, h.method ?? 'ROUND_ROBIN', h.assignedById ?? null],
  );
  return rows[0].id;
}

export async function listHistoryForProperty(propertyId: string, limit: number, offset: number) {
  const { rows } = await pool.query<AssignmentHistoryRow>(
    `SELECT h.*, u.name AS executive_name, u.username AS executive_username, ab.name AS assigned_by_name
     FROM property_assignment_history h JOIN users u ON u.id = h.executive_id
     LEFT JOIN users ab ON ab.id = h.assigned_by_id
     WHERE h.property_id = $1
     ORDER BY h.created_at DESC, h.id DESC LIMIT $2 OFFSET $3`,
    [propertyId, limit, offset],
  );
  return rows;
}
