import { randomUUID } from 'node:crypto';
import { pool } from '../../database/pool';

export interface NotificationJob {
  id: string;
  lead_id: string;
  executive_id: string;
  recipient_email: string;
  sender_email: string | null;
  lead_no: string;
  customer_name: string;
  property_name: string;
  source: string;
  executive_name: string;
  assigned_at: Date;
  attempt_count: number;
}

export async function enqueue(input: { eventKey: string; leadId: string; executiveId: string; recipientEmail: string; assignedAt: Date }): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO email_notification_logs (assignment_event_key, lead_id, executive_id, recipient_email, assignment_created_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (assignment_event_key) DO NOTHING`,
    [input.eventKey, input.leadId, input.executiveId, input.recipientEmail, input.assignedAt],
  );
  return rowCount === 1;
}

export async function claim(limit = 10): Promise<NotificationJob[]> {
  const worker = `api-${process.pid}-${randomUUID()}`;
  const { rows } = await pool.query<NotificationJob>(
    `WITH picked AS (
       SELECT id FROM email_notification_logs
       WHERE ((status IN ('QUEUED','FAILED') AND next_attempt_at <= now())
          OR (status = 'PROCESSING' AND locked_at < now() - interval '10 minutes'))
       ORDER BY created_at, id LIMIT $1 FOR UPDATE SKIP LOCKED
     )
     UPDATE email_notification_logs n SET status = 'PROCESSING', attempt_count = n.attempt_count + 1,
       locked_at = now(), locked_by = $2
     FROM picked p WHERE n.id = p.id
     RETURNING n.id, n.lead_id, n.executive_id, n.recipient_email, n.sender_email,
       (SELECT lead_no::text FROM leads WHERE id = n.lead_id) AS lead_no,
       (SELECT name FROM customers c JOIN leads l3 ON l3.customer_id = c.id WHERE l3.id = n.lead_id) AS customer_name,
       (SELECT name FROM properties p2 JOIN leads l2 ON l2.property_id = p2.id WHERE l2.id = n.lead_id) AS property_name,
       (SELECT source::text FROM leads WHERE id = n.lead_id) AS source,
       (SELECT name FROM users WHERE id = n.executive_id) AS executive_name,
       n.assignment_created_at AS assigned_at,
       n.attempt_count`,
    [limit, worker],
  );
  return rows;
}

export async function retry(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE email_notification_logs SET status = 'QUEUED', next_attempt_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL WHERE id = $1 AND status = 'FAILED'`, [id]);
  return rowCount === 1;
}

export async function setNotificationEnabled(enabled: boolean): Promise<void> {
  await pool.query(`UPDATE zoho_mail_integrations SET notification_enabled = $1, updated_at = now() WHERE singleton_key = true`, [enabled]);
}

export async function markSent(id: string, senderEmail: string, providerMessageId: string | null): Promise<void> {
  await pool.query(`UPDATE email_notification_logs SET status = 'SENT', sender_email = $2, provider_message_id = $3, sent_at = now(), locked_at = NULL, locked_by = NULL WHERE id = $1`, [id, senderEmail, providerMessageId]);
}

export async function markFailed(id: string, error: string, retry: boolean, delayMs: number): Promise<void> {
  await pool.query(
    `UPDATE email_notification_logs SET status = 'FAILED', last_error = $2,
       next_attempt_at = now() + ($3::bigint * interval '1 millisecond'), locked_at = NULL, locked_by = NULL
     WHERE id = $1`,
    [id, error.slice(0, 500), retry ? delayMs : 365 * 24 * 60 * 60 * 1000],
  );
}

export async function recentFailures(limit = 20) {
  const { rows } = await pool.query(`SELECT id, lead_id AS "leadId", executive_id AS "executiveId", recipient_email AS "recipientEmail", status, attempt_count AS "attemptCount", last_error AS "lastError", created_at AS "createdAt" FROM email_notification_logs WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT $1`, [limit]);
  return rows;
}
