import { Db, query, queryOne } from '../db/pool';
import { Pagination, offsetOf } from '../utils/pagination';

export const notificationRepository = {
  list: (db: Db, f: { userId?: number; unread?: boolean }, p: Pagination) =>
    query<any>(db,
      `SELECT *, count(*) OVER () AS total_count FROM notifications
       WHERE ($1::bigint IS NULL OR user_id = $1) AND (NOT COALESCE($2::boolean, false) OR read_at IS NULL)
       ORDER BY id DESC LIMIT $3 OFFSET $4`, [f.userId ?? null, f.unread ?? null, p.limit, offsetOf(p)]),

  markRead: (db: Db, id: number) =>
    queryOne(db, `UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 RETURNING *`, [id]),
};
