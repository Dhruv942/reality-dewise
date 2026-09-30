import { withTransaction } from '../db/pool';
import { followUpRepository } from '../repositories/followUpRepository';
import { leadRepository } from '../repositories/leadRepository';
import { noteRepository } from '../repositories/noteRepository';
import { BusinessRuleError, NotFoundError } from '../utils/errors';
import { scheduleFollowUp } from './followUpService';
import { transitionLead } from './leadStatusService';
import { getLead } from './leadService';

const CONTACTABLE = ['ASSIGNED', 'CONTACTED', 'FOLLOW_UP'];

/**
 * POST /leads/:id/contact — the executive reached the customer.
 * First contact: records contacted_at, marks the assignment ATTENDED (SLA no longer applies) and moves ASSIGNED -> CONTACTED.
 * Later contacts on a FOLLOW_UP lead complete the follow-ups that were due.
 * Optional notes go to lead_notes; an optional nextFollowUpAt schedules a follow-up (-> FOLLOW_UP).
 */
export async function contactLead(leadId: number, input: { notes?: string; nextFollowUpAt?: Date; userId?: number }) {
  await withTransaction(async (tx) => {
    let lead = await leadRepository.lockById(tx, leadId);
    if (!lead) throw new NotFoundError('Lead');
    if (!CONTACTABLE.includes(lead.status)) throw new BusinessRuleError(`Cannot record contact for a lead in ${lead.status} status`);
    const actor = input.userId ?? lead.assignedTo;

    if (lead.status === 'ASSIGNED') {
      lead = await transitionLead(tx, lead, 'CONTACTED', { changedBy: actor, reason: 'Customer contacted' });
    } else if (lead.status === 'FOLLOW_UP') {
      await followUpRepository.completeDue(tx, lead.id);
    }
    if (input.notes) await noteRepository.insert(tx, { leadId, authorId: actor, note: input.notes });
    if (input.nextFollowUpAt) {
      await scheduleFollowUp(tx, lead, { scheduledAt: input.nextFollowUpAt, notes: input.notes, changedBy: actor });
    }
  });
  return getLead(leadId);
}
