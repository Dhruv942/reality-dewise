import type { PoolClient } from 'pg';
import type { Lead, LeadStatus } from '../models/types';
import { assignmentRepository } from '../repositories/assignmentRepository';
import { followUpRepository } from '../repositories/followUpRepository';
import { leadRepository } from '../repositories/leadRepository';
import { BusinessRuleError, NotFoundError } from '../utils/errors';
import { assertTransition, isFinal } from './leadStatus';

export interface TransitionOpts { changedBy?: number | null; reason?: string }

/**
 * Applies a validated status change to an already-locked lead, with all side effects, inside the caller's transaction:
 *  - CONTACTED (first time): records contacted_at and marks the assignment ATTENDED, so the SLA stops applying.
 *  - final status: releases an unattended assignment and cancels open follow-ups.
 *  - always writes lead_status_history.
 */
export async function transitionLead(tx: PoolClient, lead: Lead, to: LeadStatus, opts: TransitionOpts = {}): Promise<Lead> {
  assertTransition(lead.status, to);

  if (to === 'CONTACTED' && !lead.contactedAt) {
    await leadRepository.markContacted(tx, lead.id);
    await assignmentRepository.markAttended(tx, lead.id);
  }
  if (isFinal(to)) {
    await assignmentRepository.releaseActive(tx, lead.id);
    await followUpRepository.cancelOpen(tx, lead.id);
  }

  const updated = await leadRepository.setStatus(tx, lead.id, to);
  await leadRepository.insertStatusHistory(tx, { leadId: lead.id, fromStatus: lead.status, toStatus: to, changedBy: opts.changedBy ?? null, reason: opts.reason });
  return updated;
}

/** Public status change (PATCH /leads/:id/status). ASSIGNED is reserved for the assignment service. */
export async function changeLeadStatus(tx: PoolClient, leadId: number, to: LeadStatus, opts: TransitionOpts): Promise<Lead> {
  if (to === 'ASSIGNED') throw new BusinessRuleError('ASSIGNED is set automatically by lead assignment');
  const lead = await leadRepository.lockById(tx, leadId);
  if (!lead) throw new NotFoundError('Lead');
  return transitionLead(tx, lead, to, opts);
}
