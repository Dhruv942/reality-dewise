import type { Db } from '../../database/transaction';
import type { AvailabilityService } from './availability.service';
import type { AssignmentRule } from './assignment.rules';
import * as repo from './assignment.repository';

/**
 * A strategy picks the executive for one lead of one property, or null when nobody can take it. It runs inside
 * the caller's transaction, after the property row is locked, and must keep any state it needs consistent
 * under concurrency (see round robin's row lock).
 */
export type AssignmentStrategy = (ctx: {
  tx: Db;
  propertyId: string;
  availability: AvailabilityService;
  /** Executives that must not be picked (for a timeout reassignment: the one who did not handle the lead). */
  excludeExecutiveIds?: string[];
}) => Promise<string | null>;

/**
 * Round robin over the executives picked for the property who are available, in a stable order, continuing
 * after the last assigned executive and wrapping around. The pointer is one row per property that is locked
 * `FOR UPDATE`, so two leads arriving at the same moment queue up and can never take the same position.
 */
const roundRobin: AssignmentStrategy = async ({ tx, propertyId, availability, excludeExecutiveIds = [] }) => {
  const lastId = await repo.lockPropertyState(tx, propertyId);
  const members = await repo.listRotation(tx, propertyId, lastId);
  const available = await availability.getAvailableExecutiveIds(
    members.map((m) => m.id),
    tx,
  );
  const pool = members.filter((m) => available.has(m.id) && !excludeExecutiveIds.includes(m.id));
  const next = pool.find((m) => m.afterLast) ?? pool[0];
  if (!next) return null;
  await repo.setLastAssigned(tx, propertyId, next.id);
  return next.id;
};

export const ASSIGNMENT_STRATEGIES: Record<AssignmentRule, AssignmentStrategy> = {
  ROUND_ROBIN: roundRobin,
};
