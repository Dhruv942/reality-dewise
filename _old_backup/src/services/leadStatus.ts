import type { LeadStatus } from '../models/types';
import { BusinessRuleError } from '../utils/errors';

/**
 * Single source of truth for lifecycle rules. To add a status: add it to the DB enum, then list it here.
 * NEW -> ASSIGNED is performed by the assignment service (never directly via the API).
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['ASSIGNED', 'INVALID'],
  ASSIGNED: ['CONTACTED', 'INVALID'],
  CONTACTED: ['FOLLOW_UP', 'CLOSED', 'LOST', 'INVALID'],
  FOLLOW_UP: ['CONTACTED', 'CLOSED', 'LOST', 'INVALID'],
  CLOSED: [],
  LOST: [],
  INVALID: [],
};

export const FINAL_STATUSES: readonly LeadStatus[] = ['CLOSED', 'LOST', 'INVALID'];
export const isFinal = (s: LeadStatus) => FINAL_STATUSES.includes(s);

export function assertTransition(from: LeadStatus, to: LeadStatus): void {
  if (!LEAD_STATUS_TRANSITIONS[from].includes(to)) {
    const allowed = LEAD_STATUS_TRANSITIONS[from];
    throw new BusinessRuleError(
      `Cannot move lead from ${from} to ${to}. Allowed: ${allowed.length ? allowed.join(', ') : 'none (final status)'}`);
  }
}
