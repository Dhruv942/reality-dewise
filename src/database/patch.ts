import { pool } from './pool';

/**
 * Partial UPDATE. Table and column names must be code constants (never user input);
 * values are always parameterised. `undefined` values are skipped, `null` sets NULL.
 */
export async function patchRow(table: 'users' | 'teams' | 'properties' | 'customers' | 'leads', id: string, columns: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;
  const sets = entries.map(([col], i) => `${col} = $${i + 2}`).join(', ');
  await pool.query(`UPDATE ${table} SET ${sets} WHERE id = $1`, [id, ...entries.map(([, v]) => v)]);
}
