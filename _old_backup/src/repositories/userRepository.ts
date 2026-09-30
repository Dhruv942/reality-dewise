import { Db, query, queryOne } from '../db/pool';
import type { User } from '../models/types';

export const userRepository = {
  findById: (db: Db, id: number) => queryOne<User>(db, `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]),

  list: (db: Db, f: { teamId?: number; isActive?: boolean }) =>
    query<User>(db,
      `SELECT * FROM users WHERE deleted_at IS NULL
         AND ($1::bigint IS NULL OR team_id = $1) AND ($2::boolean IS NULL OR is_active = $2) ORDER BY id`,
      [f.teamId ?? null, f.isActive ?? null]),

  /**
   * Next eligible executive in the team's rotation: the first active member with id greater than the
   * last assigned one, wrapping around to the lowest id. Inactive/deleted users are skipped, and a
   * removed pointer user does not break the rotation because ordering is purely by id.
   */
  nextEligible: (db: Db, teamId: number, afterUserId: number | null, excludeIds: number[]) =>
    queryOne<User>(db,
      `SELECT * FROM users
       WHERE team_id = $1 AND is_active AND deleted_at IS NULL AND id <> ALL($3::bigint[])
       ORDER BY (id > COALESCE($2::bigint, 0)) DESC, id ASC LIMIT 1`,
      [teamId, afterUserId, excludeIds]),
};
