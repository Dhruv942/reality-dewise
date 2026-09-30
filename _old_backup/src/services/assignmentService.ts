import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { pool, withTransaction } from '../db/pool';
import type { Lead, LeadAssignment, LockedLead } from '../models/types';
import { notifier } from '../notifications/notifier';
import { assignmentRepository } from '../repositories/assignmentRepository';
import { leadRepository } from '../repositories/leadRepository';
import { teamRepository } from '../repositories/teamRepository';
import { userRepository } from '../repositories/userRepository';
import { AppError, BusinessRuleError, ConflictError, NotFoundError } from '../utils/errors';
import { isFinal } from './leadStatus';

export interface Allocation { lead: Lead; assignment: LeadAssignment }
export type AssignReason = 'INITIAL' | 'SLA_EXPIRED';

/**
 * Picks the next executive (round-robin) and persists the assignment. Caller holds the lead row lock and a transaction.
 *
 * Concurrency: the team row is locked FOR UPDATE for the read-pick-write of the rotation pointer, so two
 * simultaneous leads for one team are serialized and get consecutive executives; different teams don't block
 * each other. Lock order is always lead -> team, so there is no deadlock cycle.
 *
 * Returns null when the project has no active team or the team has no active executive.
 */
export async function allocate(tx: PoolClient, lead: LockedLead, reason: AssignReason): Promise<Allocation | null> {
  if (!lead.projectTeamId) return null;
  const team = await teamRepository.lockActive(tx, lead.projectTeamId);
  if (!team) return null;

  // Prefer someone who hasn't already had (and missed) this lead; fall back to anyone but the current owner;
  // finally allow the same person again if they're the only active executive.
  const previous = await assignmentRepository.previousAssigneeIds(tx, lead.id);
  const current = lead.assignedTo ? [lead.assignedTo] : [];
  let user = null;
  for (const excluded of [previous, current, []]) {
    user = await userRepository.nextEligible(tx, team.id, team.lastAssignedUserId, excluded);
    if (user) break;
  }
  if (!user) return null;

  await teamRepository.setLastAssigned(tx, team.id, user.id);
  const isReassignment = reason === 'SLA_EXPIRED';
  const slaMinutes = lead.projectSlaMinutes ?? env.DEFAULT_LEAD_SLA_MINUTES;
  const updated = await leadRepository.applyAssignment(tx, lead.id, user.id, slaMinutes, isReassignment);
  const assignment = await assignmentRepository.insert(tx, {
    leadId: lead.id, userId: user.id, teamId: team.id, reason,
    assignedAt: updated.assignedAt!, slaDeadline: updated.slaDeadline!,
  });

  if (lead.status !== 'ASSIGNED') {
    await leadRepository.insertStatusHistory(tx, { leadId: lead.id, fromStatus: lead.status, toStatus: 'ASSIGNED', reason: 'Auto-assigned (round robin)' });
  }
  await notifier.notify(tx, {
    userId: user.id,
    type: isReassignment ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED',
    title: isReassignment ? 'Lead reassigned to you' : 'New lead assigned to you',
    body: `Lead #${lead.id} - contact within ${slaMinutes} minutes`,
    leadId: lead.id,
    payload: { slaDeadline: updated.slaDeadline },
  });
  return { lead: updated, assignment };
}

/** Initial assignment of a NEW lead. Safe to call again: a lead that already has a current assignment is rejected. */
export async function assignLead(tx: PoolClient, leadId: number): Promise<Allocation | null> {
  const lead = await leadRepository.lockWithProject(tx, leadId);
  if (!lead) throw new NotFoundError('Lead');
  if (isFinal(lead.status)) throw new BusinessRuleError(`Lead is ${lead.status} and cannot be assigned`);
  if (await assignmentRepository.findCurrent(tx, leadId)) throw new ConflictError('Lead is already assigned');
  return allocate(tx, lead, 'INITIAL');
}

/**
 * Admin override: hand an unattended lead to a specific executive. Ends the current assignment (kept in
 * history as RELEASED), starts a fresh SLA window and does not move the round-robin pointer.
 */
export async function assignLeadToUser(tx: PoolClient, leadId: number, userId: number): Promise<Allocation> {
  const lead = await leadRepository.lockWithProject(tx, leadId);
  if (!lead) throw new NotFoundError('Lead');
  if (lead.status !== 'NEW' && lead.status !== 'ASSIGNED') {
    throw new BusinessRuleError(`Only leads that have not been contacted yet can be assigned manually (lead is ${lead.status})`);
  }
  const user = await userRepository.findById(tx, userId);
  if (!user || !user.isActive) throw new BusinessRuleError('Executive not found or inactive');
  if (lead.assignedTo === userId) throw new ConflictError('Lead is already assigned to this executive');
  const teamId = user.teamId ?? lead.projectTeamId;
  if (!teamId) throw new BusinessRuleError('Executive does not belong to a team');

  const isReassignment = lead.assignedTo !== null;
  await assignmentRepository.endCurrent(tx, leadId);
  const slaMinutes = lead.projectSlaMinutes ?? env.DEFAULT_LEAD_SLA_MINUTES;
  const updated = await leadRepository.applyAssignment(tx, leadId, userId, slaMinutes, isReassignment);
  const assignment = await assignmentRepository.insert(tx, {
    leadId, userId, teamId, reason: 'MANUAL', assignedAt: updated.assignedAt!, slaDeadline: updated.slaDeadline!,
  });
  if (lead.status !== 'ASSIGNED') {
    await leadRepository.insertStatusHistory(tx, { leadId, fromStatus: lead.status, toStatus: 'ASSIGNED', reason: 'Manually assigned' });
  }
  await notifier.notify(tx, {
    userId, type: isReassignment ? 'LEAD_REASSIGNED' : 'LEAD_ASSIGNED',
    title: isReassignment ? 'Lead reassigned to you' : 'New lead assigned to you',
    body: `Lead #${leadId} - contact within ${slaMinutes} minutes`, leadId, payload: { slaDeadline: updated.slaDeadline },
  });
  return { lead: updated, assignment };
}

export const assignLeadManually = (leadId: number, userId: number) =>
  withTransaction((tx) => assignLeadToUser(tx, leadId, userId));

/** Job entry point: retries NEW leads that were left unassigned because no executive was available. */
export async function assignPendingLeads(limit = 100): Promise<number> {
  const ids = await leadRepository.unassignedIds(pool, limit);
  let assigned = 0;
  for (const id of ids) {
    try {
      const result = await withTransaction((tx) => assignLead(tx, id));
      if (result) assigned++;
    } catch (err) {
      if (!(err instanceof AppError)) throw err; // already assigned by someone else / became final: skip
    }
  }
  return assigned;
}
