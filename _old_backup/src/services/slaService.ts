import { env } from '../config/env';
import { withTransaction } from '../db/pool';
import { notifier } from '../notifications/notifier';
import { assignmentRepository } from '../repositories/assignmentRepository';
import { leadRepository } from '../repositories/leadRepository';
import { BusinessRuleError, NotFoundError } from '../utils/errors';
import { allocate } from './assignmentService';
import type { PoolClient } from 'pg';

type Expired = { id: number; leadId: number; userId: number };

/**
 * Handles ONE expired assignment inside the caller's transaction:
 *   expire the assignment -> pick the next eligible executive -> new assignment + new SLA window.
 * If nobody is eligible the lead returns to the NEW pool and assignPendingLeads() retries it later.
 */
async function expireAndReassign(tx: PoolClient, expired: Expired) {
  const lead = (await leadRepository.lockWithProject(tx, expired.leadId))!;
  await assignmentRepository.expire(tx, expired.id);
  await notifier.notify(tx, {
    userId: expired.userId, type: 'SLA_EXPIRED', title: 'SLA expired - lead taken away',
    body: `Lead #${lead.id} was not contacted in time and has been reassigned`, leadId: lead.id,
  });

  const next = await allocate(tx, lead, 'SLA_EXPIRED');
  if (!next) {
    await leadRepository.release(tx, lead.id);
    await leadRepository.insertStatusHistory(tx, { leadId: lead.id, fromStatus: lead.status, toStatus: 'NEW', reason: 'SLA expired and no eligible executive available' });
  }
  return next;
}

/** One expired assignment per transaction (short locks, failures isolated). Returns false when nothing is expired. */
async function reassignNextExpired(): Promise<boolean> {
  return withTransaction(async (tx) => {
    const expired = await assignmentRepository.lockNextExpired(tx);
    if (!expired) return false;
    await expireAndReassign(tx, expired);
    return true;
  });
}

/** Reassigns every lead whose SLA has expired without being attended. Returns how many were processed. */
export async function processExpiredAssignments(maxPerRun = 200): Promise<number> {
  let processed = 0;
  while (processed < maxPerRun && (await reassignNextExpired())) processed++;
  return processed;
}

/** Demo/admin utility: treat a lead's running SLA as expired right now (same code path as the job). */
export async function forceExpireLead(leadId: number) {
  return withTransaction(async (tx) => {
    if (!(await leadRepository.lockById(tx, leadId))) throw new NotFoundError('Lead');
    const active = await assignmentRepository.lockActiveByLead(tx, leadId);
    if (!active) throw new BusinessRuleError('Lead has no running SLA to expire');
    const next = await expireAndReassign(tx, active);
    return { previousUserId: active.userId, newUserId: next?.assignment.userId ?? null };
  });
}

/** "SLA about to expire" nudges, sent once per assignment. */
export async function sendSlaWarnings(): Promise<number> {
  return withTransaction(async (tx) => {
    const claimed = await assignmentRepository.claimSlaWarnings(tx, env.SLA_WARNING_MINUTES);
    for (const a of claimed) {
      await notifier.notify(tx, {
        userId: a.userId, type: 'SLA_APPROACHING', title: 'SLA expiring soon',
        body: `Lead #${a.leadId} must be contacted before ${a.slaDeadline.toISOString()}`, leadId: a.leadId,
        payload: { slaDeadline: a.slaDeadline },
      });
    }
    return claimed.length;
  });
}
