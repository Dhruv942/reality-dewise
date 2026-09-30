import type { Db } from '../../database/transaction';
import { pool } from '../../database/pool';
import type { AssignmentHistoryRow, AssignmentReason, AssignmentType } from './assignment.model';

export const HISTORY_LEAD_UNIQUE = 'property_assignment_history_lead_id_key';

export interface PropertyForAssignment {
  id: string;
  is_active: boolean;
  team_id: string | null;
  team_is_active: boolean | null;
  primary_executive_id: string | null;
}

/** FOR SHARE: admin edits to the property wait until the in-flight assignment commits. */
export async function lockProperty(db: Db, id: string): Promise<PropertyForAssignment | null> {
  const { rows } = await db.query<PropertyForAssignment>(
    `SELECT p.id, p.is_active, p.team_id, t.is_active AS team_is_active, p.primary_executive_id
     FROM properties p LEFT JOIN teams t ON t.id = p.team_id
     WHERE p.id = $1 FOR SHARE OF p`,
    [id],
  );
  return rows[0] ?? null;
}

export async function findHistoryByLead(db: Db, leadId: string): Promise<AssignmentHistoryRow | null> {
  const { rows } = await db.query<AssignmentHistoryRow>(
    'SELECT * FROM property_assignment_history WHERE lead_id = $1',
    [leadId],
  );
  return rows[0] ?? null;
}

/** Creates the team's state row if needed, then locks it. Serialises round-robin per team. */
export async function lockTeamState(db: Db, teamId: string): Promise<string | null> {
  await db.query('INSERT INTO team_assignment_state (team_id) VALUES ($1) ON CONFLICT DO NOTHING', [teamId]);
  const { rows } = await db.query<{ last_assigned_executive_id: string | null }>(
    'SELECT last_assigned_executive_id FROM team_assignment_state WHERE team_id = $1 FOR UPDATE',
    [teamId],
  );
  return rows[0].last_assigned_executive_id;
}

export const setLastAssigned = (db: Db, teamId: string, executiveId: string) =>
  db.query('UPDATE team_assignment_state SET last_assigned_executive_id = $2, updated_at = now() WHERE team_id = $1', [
    teamId,
    executiveId,
  ]);

/**
 * All live executives of the team in a stable rotation order (created_at, id), each flagged
 * with whether it sorts after the last assigned executive. The last executive is looked up by
 * id whatever its current status/team, so the pointer survives them being deactivated or moved.
 */
export async function listRotation(db: Db, teamId: string, lastId: string | null) {
  const { rows } = await db.query<{ id: string; after_last: boolean | null }>(
    `SELECT u.id,
            (u.created_at, u.id) > (SELECT l.created_at, l.id FROM users l WHERE l.id = $2::uuid) AS after_last
     FROM users u
     WHERE u.team_id = $1 AND u.role = 'EXECUTIVE' AND u.deleted_at IS NULL
     ORDER BY u.created_at, u.id`,
    [teamId, lastId],
  );
  return rows.map((r) => ({ id: r.id, afterLast: r.after_last === true }));
}

export async function insertHistory(
  db: Db,
  h: {
    propertyId: string;
    teamId: string;
    executiveId: string;
    type: AssignmentType;
    reason: AssignmentReason;
    leadId: string;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO property_assignment_history (property_id, team_id, executive_id, assignment_type, reason, lead_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [h.propertyId, h.teamId, h.executiveId, h.type, h.reason, h.leadId],
  );
  return rows[0].id;
}

export async function listHistoryForProperty(propertyId: string, limit: number, offset: number) {
  const { rows } = await pool.query<AssignmentHistoryRow>(
    `SELECT h.*, u.name AS executive_name, u.username AS executive_username
     FROM property_assignment_history h JOIN users u ON u.id = h.executive_id
     WHERE h.property_id = $1
     ORDER BY h.created_at DESC, h.id DESC LIMIT $2 OFFSET $3`,
    [propertyId, limit, offset],
  );
  return rows;
}
