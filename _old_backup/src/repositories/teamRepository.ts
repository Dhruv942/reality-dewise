import { Db, queryOne, query } from '../db/pool';
import type { Team, User } from '../models/types';

export const teamRepository = {
  findById: (db: Db, id: number) => queryOne<Team>(db, `SELECT * FROM teams WHERE id = $1 AND deleted_at IS NULL`, [id]),

  list: (db: Db) => query<Team>(db, `SELECT * FROM teams WHERE deleted_at IS NULL ORDER BY id`),

  /** Row lock on the team serializes concurrent assignments for the same team (the round-robin critical section). */
  lockActive: (db: Db, id: number) =>
    queryOne<Team>(db, `SELECT * FROM teams WHERE id = $1 AND is_active AND deleted_at IS NULL FOR UPDATE`, [id]),

  async setLastAssigned(db: Db, id: number, userId: number) {
    await db.query(`UPDATE teams SET last_assigned_user_id = $2 WHERE id = $1`, [id, userId]);
  },

  members: (db: Db, teamId: number) =>
    query<User>(db, `SELECT * FROM users WHERE team_id = $1 AND deleted_at IS NULL ORDER BY id`, [teamId]),
};
