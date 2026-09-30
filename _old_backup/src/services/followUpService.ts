import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { pool, withTransaction } from '../db/pool';
import type { FollowUp, Lead } from '../models/types';
import { notifier } from '../notifications/notifier';
import { followUpRepository } from '../repositories/followUpRepository';
import { leadRepository } from '../repositories/leadRepository';
import { BusinessRuleError, NotFoundError, ValidationError } from '../utils/errors';
import { Pagination, toPage } from '../utils/pagination';
import { transitionLead } from './leadStatusService';

const SCHEDULABLE = ['CONTACTED', 'FOLLOW_UP'];

/** Creates a follow-up on a locked lead. A CONTACTED lead with a pending follow-up becomes FOLLOW_UP. */
export async function scheduleFollowUp(
  tx: PoolClient, lead: Lead, input: { scheduledAt: Date; notes?: string | null; assignedTo?: number | null; changedBy?: number | null },
): Promise<{ followUp: FollowUp; lead: Lead }> {
  if (!SCHEDULABLE.includes(lead.status)) {
    throw new BusinessRuleError(`Follow-ups can only be scheduled for CONTACTED or FOLLOW_UP leads (lead is ${lead.status})`);
  }
  if (input.scheduledAt.getTime() <= Date.now()) throw new ValidationError('Follow-up time must be in the future');

  const followUp = await followUpRepository.insert(tx, {
    leadId: lead.id, assignedTo: input.assignedTo ?? lead.assignedTo, scheduledAt: input.scheduledAt, notes: input.notes,
  });
  const updated = lead.status === 'CONTACTED'
    ? await transitionLead(tx, lead, 'FOLLOW_UP', { changedBy: input.changedBy, reason: 'Follow-up scheduled' })
    : lead;
  return { followUp, lead: updated };
}

export async function createFollowUp(leadId: number, input: { scheduledAt: Date; notes?: string; assignedTo?: number }) {
  return withTransaction(async (tx) => {
    const lead = await leadRepository.lockById(tx, leadId);
    if (!lead) throw new NotFoundError('Lead');
    return (await scheduleFollowUp(tx, lead, { ...input, changedBy: input.assignedTo })).followUp;
  });
}

export async function listLeadFollowUps(leadId: number) {
  if (!(await leadRepository.findById(pool, leadId))) throw new NotFoundError('Lead');
  return followUpRepository.listByLead(pool, leadId);
}

export async function listFollowUps(f: { status?: string; assignedTo?: number; from?: Date; to?: Date }, p: Pagination) {
  return toPage(await followUpRepository.list(pool, f, p), p);
}

export async function getFollowUp(id: number) {
  const f = await followUpRepository.findById(pool, id);
  if (!f) throw new NotFoundError('Follow-up');
  return f;
}

async function lockOpenFollowUp(tx: PoolClient, id: number): Promise<FollowUp> {
  const f = await followUpRepository.lockById(tx, id);
  if (!f) throw new NotFoundError('Follow-up');
  if (f.status !== 'PENDING' && f.status !== 'MISSED') throw new BusinessRuleError(`Follow-up is already ${f.status}`);
  return f;
}

/** Completes a follow-up and, optionally, schedules the next one in the same transaction. */
export async function completeFollowUp(id: number, input: { notes?: string; nextFollowUpAt?: Date }) {
  return withTransaction(async (tx) => {
    const current = await lockOpenFollowUp(tx, id);
    const done = (await followUpRepository.update(tx, id, { status: 'COMPLETED', notes: input.notes }))!;
    let next: FollowUp | null = null;
    if (input.nextFollowUpAt) {
      const lead = (await leadRepository.lockById(tx, current.leadId))!;
      next = (await scheduleFollowUp(tx, lead, { scheduledAt: input.nextFollowUpAt, assignedTo: current.assignedTo })).followUp;
    }
    return { followUp: done, next };
  });
}

export async function cancelFollowUp(id: number) {
  return withTransaction(async (tx) => {
    await lockOpenFollowUp(tx, id);
    return (await followUpRepository.update(tx, id, { status: 'CANCELLED' }))!;
  });
}

export async function rescheduleFollowUp(id: number, input: { scheduledAt?: Date; notes?: string }) {
  if (input.scheduledAt && input.scheduledAt.getTime() <= Date.now()) throw new ValidationError('Follow-up time must be in the future');
  return withTransaction(async (tx) => {
    const current = await lockOpenFollowUp(tx, id);
    // A rescheduled MISSED follow-up is pending again.
    const status = input.scheduledAt && current.status === 'MISSED' ? 'PENDING' : undefined;
    return (await followUpRepository.update(tx, id, { status, scheduledAt: input.scheduledAt, notes: input.notes }))!;
  });
}

/** Job: reminds executives of follow-ups due soon (once each). */
export async function sendFollowUpReminders(): Promise<number> {
  return withTransaction(async (tx) => {
    const due = await followUpRepository.claimReminders(tx, env.FOLLOW_UP_REMINDER_MINUTES);
    for (const f of due) {
      await notifier.notify(tx, {
        userId: f.assignedTo!, type: 'FOLLOW_UP_DUE', title: 'Follow-up due',
        body: `Follow-up for lead #${f.leadId} is scheduled at ${f.scheduledAt.toISOString()}`, leadId: f.leadId,
        payload: { followUpId: f.id, scheduledAt: f.scheduledAt },
      });
    }
    return due.length;
  });
}

/** Job: follow-ups nobody acted on within the grace period become MISSED. */
export const markMissedFollowUps = () => followUpRepository.markMissed(pool, env.FOLLOW_UP_MISSED_GRACE_MINUTES);
