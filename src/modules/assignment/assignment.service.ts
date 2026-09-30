import { withTransaction, type Db } from '../../database/transaction';
import { pool } from '../../database/pool';
import { AppError, NotFoundError } from '../../utils/errors';
import {
  ActiveStatusAvailabilityService,
  isExecutiveAvailable,
  type AvailabilityService,
} from './availability.service';
import type { AssignmentReason, AssignmentResult, AssignmentType } from './assignment.model';
import * as repo from './assignment.repository';

type Choice = { executiveId: string; type: AssignmentType; reason: AssignmentReason };

/**
 * Decides which executive receives a lead for a property.
 *
 *   inactive property / no team / inactive team  -> rejected
 *   primary executive set and available          -> PRIMARY
 *   primary set but unavailable                  -> ROUND_ROBIN over the team's available executives
 *   no primary executive                         -> ROUND_ROBIN over the team's available executives
 *
 * The property's primary executive is never modified by fallback assignments.
 * The whole decision, the round-robin pointer update and the history row commit atomically.
 */
export class PropertyAssignmentService {
  constructor(private readonly availability: AvailabilityService = new ActiveStatusAvailabilityService()) {}

  /**
   * Pass `tx` to run inside the caller's transaction (e.g. lead creation), so the lead row and its
   * assignment commit or roll back together. The caller is then responsible for commit/rollback.
   */
  async assignLeadToProperty(propertyId: string, leadId: string, tx?: Db): Promise<AssignmentResult> {
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

  private async existingAssignment(db: Db, propertyId: string, leadId: string): Promise<AssignmentResult | null> {
    const h = await repo.findHistoryByLead(db, leadId);
    if (!h) return null;
    if (h.property_id !== propertyId) throw new AppError(409, 'Lead is already assigned via a different property');
    return {
      historyId: h.id,
      propertyId: h.property_id,
      teamId: h.team_id,
      leadId,
      executiveId: h.executive_id,
      assignmentType: h.assignment_type,
      reason: h.reason,
      alreadyAssigned: true,
    };
  }

  private async decideAndRecord(tx: Db, propertyId: string, leadId: string): Promise<AssignmentResult> {
    const property = await repo.lockProperty(tx, propertyId);
    if (!property) throw new NotFoundError('Property not found');
    if (!property.is_active) throw new AppError(409, 'Property is inactive and cannot receive leads');
    if (!property.team_id) throw new AppError(409, 'Property has no team configured');
    if (!property.team_is_active) throw new AppError(409, "Property's team is inactive");
    const teamId = property.team_id;

    let choice: Choice | null = null;
    let reason: AssignmentReason = 'NO_PRIMARY_EXECUTIVE';

    if (property.primary_executive_id) {
      if (await isExecutiveAvailable(this.availability, property.primary_executive_id, tx)) {
        choice = {
          executiveId: property.primary_executive_id,
          type: 'PRIMARY',
          reason: 'PRIMARY_EXECUTIVE_AVAILABLE',
        };
      }
      reason = 'PRIMARY_EXECUTIVE_UNAVAILABLE';
    }

    choice ??= await this.roundRobin(tx, teamId, reason);
    if (!choice) throw new AppError(409, "No available executive in the property's team");

    const historyId = await repo.insertHistory(tx, {
      propertyId,
      teamId,
      executiveId: choice.executiveId,
      type: choice.type,
      reason: choice.reason,
      leadId,
    });
    return {
      historyId,
      propertyId,
      teamId,
      leadId,
      executiveId: choice.executiveId,
      assignmentType: choice.type,
      reason: choice.reason,
      alreadyAssigned: false,
    };
  }

  /** Next available executive after the persisted pointer, wrapping around. Advances the pointer. */
  private async roundRobin(tx: Db, teamId: string, reason: AssignmentReason): Promise<Choice | null> {
    const lastId = await repo.lockTeamState(tx, teamId); // row lock: concurrent leads queue here
    const members = await repo.listRotation(tx, teamId, lastId);
    const available = await this.availability.getAvailableExecutiveIds(
      members.map((m) => m.id),
      tx,
    );
    const pool = members.filter((m) => available.has(m.id));
    const next = pool.find((m) => m.afterLast) ?? pool[0];
    if (!next) return null;

    await repo.setLastAssigned(tx, teamId, next.id);
    return { executiveId: next.id, type: 'ROUND_ROBIN', reason };
  }
}

export const propertyAssignmentService = new PropertyAssignmentService();
