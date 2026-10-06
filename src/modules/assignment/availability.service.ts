import type { Db } from '../../database/transaction';

/**
 * The single place that decides "can this executive take a lead right now?".
 * Today: an active, non-deleted SALES user. Later (leave, working hours, manual
 * "unavailable" status) only a new implementation is needed: the assignment
 * logic never looks at `is_active` itself.
 */
export interface AvailabilityService {
  /** Returns the subset of `executiveIds` that are currently available. */
  getAvailableExecutiveIds(executiveIds: string[], db: Db): Promise<Set<string>>;
}

export class ActiveStatusAvailabilityService implements AvailabilityService {
  async getAvailableExecutiveIds(executiveIds: string[], db: Db): Promise<Set<string>> {
    if (executiveIds.length === 0) return new Set();
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::uuid[]) AND role = 'SALES' AND is_active AND deleted_at IS NULL`,
      [executiveIds],
    );
    return new Set(rows.map((r) => r.id));
  }
}

export async function isExecutiveAvailable(
  service: AvailabilityService,
  executiveId: string,
  db: Db,
): Promise<boolean> {
  return (await service.getAvailableExecutiveIds([executiveId], db)).has(executiveId);
}
