import * as repo from './email-notification.repository';
import { assignmentEmail } from './email-notification.template';
import { pool } from '../../database/pool';
import { sendEmail } from '../zoho/zoho.service';

export async function enqueueAssignment(input: { leadId: string; executiveId: string; assignedAt: Date }): Promise<void> {
  try {
    const integration = (await pool.query<{ notification_enabled: boolean; status: string }>('SELECT notification_enabled, status FROM zoho_mail_integrations WHERE singleton_key = true', [])).rows[0];
    if (integration && (!integration.notification_enabled || integration.status === 'DISCONNECTED')) return;
    const executive = (await pool.query<{ email: string; is_active: boolean }>('SELECT email, is_active FROM users WHERE id = $1 AND role = \'SALES\' AND deleted_at IS NULL', [input.executiveId])).rows[0];
    if (!executive?.is_active || !executive.email) return;
    const eventKey = `${input.leadId}:${input.executiveId}:${input.assignedAt.getTime()}`;
    await repo.enqueue({ eventKey, leadId: input.leadId, executiveId: input.executiveId, recipientEmail: executive.email, assignedAt: input.assignedAt });
  } catch (err) {
    // In-app/realtime notification failures must never turn a committed lead assignment into an API failure.
    console.error('Email notification enqueue failed:', err instanceof Error ? err.message : 'unknown error');
  }
}

export async function processPending(limit = 10): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (const job of await repo.claim(limit)) {
    try {
      const template = assignmentEmail({ executiveName: job.executive_name, leadName: job.customer_name, leadNo: job.lead_no, propertyName: job.property_name, source: job.source, assignedAt: job.assigned_at ?? new Date() });
      const result = await sendEmail({ toAddress: job.recipient_email, subject: template.subject, htmlContent: template.htmlContent, textContent: template.textContent });
      const integration = (await pool.query<{ sender_email: string }>('SELECT sender_email FROM zoho_mail_integrations WHERE singleton_key = true', [])).rows[0];
      await repo.markSent(job.id, integration?.sender_email ?? '', result.providerMessageId);
      sent++;
    } catch (err) {
      const providerError = err as { permanent?: boolean; status?: number };
      const permanent = providerError.permanent === true || providerError.status === 409;
      const attempt = Math.max(1, job.attempt_count);
      await repo.markFailed(job.id, err instanceof Error ? err.message : 'Zoho Mail delivery failed', !permanent, Math.min(30 * 60_000, 2 ** attempt * 30_000));
      failed++;
    }
  }
  return { sent, failed };
}

export const listRecentFailures = () => repo.recentFailures();
export const retry = async (id: string) => repo.retry(id);
export const setNotificationEnabled = async (enabled: boolean) => repo.setNotificationEnabled(enabled);
