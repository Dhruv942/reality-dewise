import { pool } from '../../database/pool';

export type WebhookEventStatus = 'PROCESSED' | 'DUPLICATE' | 'FAILED';

/** Stores the raw body. Returns null (and logs) if even that fails: a lead must still be attempted. */
export async function record(source: string, payload: unknown): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ id: string }>('INSERT INTO webhook_events (source, payload) VALUES ($1, $2) RETURNING id', [source, JSON.stringify(payload ?? null)]);
    return rows[0].id;
  } catch (err) {
    console.error(`webhook_events insert failed (${source}):`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function settle(id: string | null, status: WebhookEventStatus, leadId: string | null, error: string | null): Promise<void> {
  if (!id) return;
  try {
    await pool.query('UPDATE webhook_events SET status = $2, lead_id = $3, error = $4, processed_at = now() WHERE id = $1', [id, status, leadId, error?.slice(0, 1000) ?? null]);
  } catch (err) {
    console.error('webhook_events update failed:', err instanceof Error ? err.message : err);
  }
}
