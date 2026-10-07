import { pool } from '../../database/pool';
import type { NotificationRow, NotificationType } from './notification.model';

export interface NewNotification {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  dedupeKey: string;
}

/** Returns the new row, or null when this event already notified this user (same dedupe key). */
export async function insertOnce(n: NewNotification): Promise<NotificationRow | null> {
  const { rows } = await pool.query<NotificationRow>(
    `INSERT INTO notifications (user_id, type, title, message, entity_type, entity_id, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, dedupe_key) DO NOTHING
     RETURNING id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, read_at`,
    [n.userId, n.type, n.title, n.message, n.entityType, n.entityId, n.dedupeKey],
  );
  return rows[0] ?? null;
}

const COLUMNS = 'id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, read_at';

export async function listForUser(userId: string, f: { unreadOnly?: boolean; limit: number; offset: number }): Promise<NotificationRow[]> {
  const { rows } = await pool.query<NotificationRow>(
    `SELECT ${COLUMNS} FROM notifications WHERE user_id = $1 ${f.unreadOnly ? 'AND NOT is_read' : ''}
     ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
    [userId, f.limit, f.offset],
  );
  return rows;
}

export async function unreadCount(userId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [userId]);
  return rows[0].n;
}

/** Only the owner's row can match, so someone else's id looks like "not found". Idempotent: read_at keeps the first read. */
export async function markRead(userId: string, id: string): Promise<NotificationRow | null> {
  const { rows } = await pool.query<NotificationRow>(
    `UPDATE notifications SET is_read = true, read_at = COALESCE(read_at, now())
     WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    [id, userId],
  );
  return rows[0] ?? null;
}

export async function markAllRead(userId: string): Promise<number> {
  const r = await pool.query('UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND NOT is_read', [userId]);
  return r.rowCount ?? 0;
}
