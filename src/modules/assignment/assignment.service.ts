import { withTransaction, type Db } from '../../database/transaction';
import { pool } from '../../database/pool';
import { AppError, NotFoundError } from '../../utils/errors';
import { ActiveStatusAvailabilityService, type AvailabilityService } from './availability.service';
import type { AssignmentResult } from './assignment.model';
import * as repo from './assignment.repository';
import { ASSIGNMENT_STRATEGIES } from './assignment.strategies';
import * as settingsRepo from '../settings/settings.repository';

/**
 * Decides which executive receives a lead for a property, using the active assignment rule (a setting only an
 * admin can change; today ROUND_ROBIN, the default) over the executives hand-picked for that property
 * (property_executives) who are currently available.
 *
 *   unknown property           -> 404
 *   inactive property          -> 409
 *   no available executive     -> null  (the caller keeps the lead as PENDING_ASSIGNMENT)
 *
 * The rotation pointer update and the history row commit atomically with the caller's transaction.
 */
export class PropertyAssignmentService {
  constructor(private readonly availability: AvailabilityService = new ActiveStatusAvailabilityService()) {}

  /**
   * Pass `tx` to run inside the caller's transaction (e.g. lead creation), so the lead row and its
   * assignment commit or roll back together. The caller is then responsible for commit/rollback.
   */
  async assignLeadToProperty(propertyId: string, leadId: string, tx?: Db): Promise<AssignmentResult | null> {
    if (tx) {
      const done = await this.existingAssignment(tx, propertyId, leadId);
      return done ?? this.decideAndRecord(tx, propertyId, leadId);
    }

    const existing = await this.existingAssignment(pool, propertyId, leadId);
    if (existing) return existing;

    try {
      return await withTransaction((tx) => this.decideAndRecord(tx, propertyId, leadId));
    } catch (err) {
      // A concurrent request for the same lead won the race: return its result instead of a second assignment.
      if ((err as { constraint?: string }).constraint === repo.HISTORY_LEAD_UNIQUE) {
        const winner = await this.existingAssignment(pool, propertyId, leadId);
        if (winner) return winner;
      }
      throw err;
    }
  }

  /**
   * The executive a timed-out lead moves to: the active rule over the property's executives, never the one
   * who currently has it. Runs inside the caller's transaction (after it locked the lead). Returns null when the
   * property is inactive or nobody else is available, so the sweep simply leaves the lead where it is.
   */
  async pickForReassignment(tx: Db, propertyId: string, excludeExecutiveIds: string[]): Promise<string | null> {
    const property = await repo.lockProperty(tx, propertyId);
    if (!property?.is_active) return null;
    const rule = await settingsRepo.getAssignmentRule(tx);
    return ASSIGNMENT_STRATEGIES[rule]({ tx, propertyId, availability: this.availability, excludeExecutiveIds });
  }

  private async existingAssignment(db: Db, propertyId: string, leadId: string): Promise<AssignmentResult | null> {
    const h = await repo.findHistoryByLead(db, leadId);
    if (!h) return null;
    if (h.property_id !== propertyId) throw new AppError(409, 'Lead is already assigned via a different property');
    return { historyId: h.id, propertyId: h.property_id, leadId, executiveId: h.executive_id, alreadyAssigned: true };
  }

  private async decideAndRecord(tx: Db, propertyId: string, leadId: string): Promise<AssignmentResult | null> {
    const property = await repo.lockProperty(tx, propertyId);
    if (!property) throw new NotFoundError('Property not found');
    if (!property.is_active) throw new AppError(409, 'Property is inactive and cannot receive leads');

    // The active rule is a setting an admin can change; it is read inside this transaction.
    const rule = await settingsRepo.getAssignmentRule(tx);
    const strategy = ASSIGNMENT_STRATEGIES[rule];
    const executiveId = await strategy({ tx, propertyId, availability: this.availability });
    if (!executiveId) return null;

    const historyId = await repo.insertHistory(tx, { propertyId, executiveId, leadId });
    return { historyId, propertyId, leadId, executiveId, alreadyAssigned: false };
  }
}

export const propertyAssignmentService = new PropertyAssignmentService();
