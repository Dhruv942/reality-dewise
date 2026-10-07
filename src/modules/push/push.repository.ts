import { pool } from '../../database/pool';

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A device keeps one row. Re-subscribing from the same browser moves it to the current user (shared computers). */
export async function upsert(s: { userId: string; endpoint: string; p256dh: string; auth: string; userAgent: string | null }): Promise<void> {
  await pool.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent, failure_count = 0`,
    [s.userId, s.endpoint, s.p256dh, s.auth, s.userAgent],
  );
}

/** Keeps the newest `keep` devices of a user; older ones are dropped. */
export async function trimToNewest(userId: string, keep: number): Promise<void> {
  await pool.query(
    `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN (
       SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2)`,
    [userId, keep],
  );
}

export const listForUser = async (userId: string): Promise<PushSubscriptionRow[]> =>
  (await pool.query<PushSubscriptionRow>('SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1', [userId])).rows;

/** Only the owner's device can be removed this way. */
export async function removeOwned(userId: string, endpoint: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  return (r.rowCount ?? 0) > 0;
}

export const removeAllForUser = async (userId: string): Promise<void> => {
  await pool.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
};

export const removeById = async (id: string): Promise<void> => {
  await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [id]);
};

export const markSuccess = async (id: string): Promise<void> => {
  await pool.query('UPDATE push_subscriptions SET failure_count = 0, last_success_at = now() WHERE id = $1', [id]);
};

/** Returns the new failure count. */
export async function markFailure(id: string): Promise<number> {
  const { rows } = await pool.query<{ failure_count: number }>(
    'UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1 RETURNING failure_count',
    [id],
  );
  return rows[0]?.failure_count ?? 0;
}
