import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import type { Db } from '../../database/transaction';
import { escapeLike } from '../../utils/like';
import type { PropertyExecutiveRow, PropertyRow } from './property.model';

/** Must stay identical to the generated column `properties.name_key` (see migration 007). */
const NAME_KEY = (param: string) => `lower(regexp_replace(btrim(${param}), '\\s+', ' ', 'g'))`;

const SELECT = `
  SELECT p.id, p.name, p.description, p.location, p.project_id, p.transaction_type, p.property_type,
         p.min_price, p.max_price, p.currency, p.price_band, p.is_active, p.is_stub, p.archived_at, p.created_at, p.updated_at,
         (SELECT count(*)::int FROM property_executives pe
            JOIN users u ON u.id = pe.executive_id AND u.deleted_at IS NULL
            WHERE pe.property_id = p.id) AS executive_count,
         (SELECT count(*)::int FROM leads l
            WHERE l.property_id = p.id AND l.status = 'PENDING_ASSIGNMENT') AS pending_lead_count,
         (SELECT count(*)::int FROM inventory i WHERE i.property_id = p.id) AS inventory_count
  FROM properties p`;

export const findById = async (id: string, db: Db = pool): Promise<PropertyRow | null> =>
  (await db.query<PropertyRow>(`${SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;

export const findByName = async (name: string, db: Db = pool): Promise<PropertyRow | null> =>
  (await db.query<PropertyRow>(`${SELECT} WHERE p.name_key = ${NAME_KEY('$1')}`, [name])).rows[0] ?? null;

/** Matches punctuation-insensitively for the property matcher; returns all candidates so ambiguity is visible. */
export async function findByNormalizedPortalName(name: string, db: Db = pool): Promise<PropertyRow[]> {
  const expression = `lower(regexp_replace(regexp_replace(btrim(p.name), '[^[:alnum:]]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  const target = `lower(regexp_replace(regexp_replace(btrim($1), '[^[:alnum:]]+', ' ', 'g'), '\\s+', ' ', 'g'))`;
  return (await db.query<PropertyRow>(`${SELECT} WHERE ${expression} = ${target}`, [name])).rows;
}

/**
 * The one place a property is created from a lead. ON CONFLICT on the unique normalised name makes it
 * race-safe: ten leads for a brand-new property arriving at once still produce exactly one property.
 * Returns the property id and whether this call created it.
 */
export async function findOrCreateStub(db: Db, name: string): Promise<{ id: string; created: boolean }> {
  const cleaned = name.trim().replace(/\s+/g, ' ');
  const ins = await db.query<{ id: string }>(
    `INSERT INTO properties (name, is_stub) VALUES ($1, true)
     ON CONFLICT (name_key) DO NOTHING RETURNING id`,
    [cleaned],
  );
  if (ins.rows[0]) return { id: ins.rows[0].id, created: true };
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM properties WHERE name_key = ${NAME_KEY('$1')}`, [cleaned]);
  return { id: rows[0].id, created: false };
}

export async function list(f: { isActive?: boolean; assigned?: boolean; search?: string; projectId?: string; transactionType?: string; propertyType?: string; status?: string }): Promise<PropertyRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.isActive !== undefined) where.push(`p.is_active = $${params.push(f.isActive)}`);
  if (f.search) {
    const s = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(p.name ILIKE ${s} OR p.location ILIKE ${s})`);
  }
  if (f.assigned !== undefined) where.push(`p.executive_count ${f.assigned ? '>' : '='} 0`);
  if (f.projectId) where.push(`p.project_id = $${params.push(f.projectId)}`);
  if (f.transactionType) where.push(`p.transaction_type = $${params.push(f.transactionType)}`);
  if (f.propertyType) where.push(`p.property_type = $${params.push(f.propertyType)}`);
  if (f.status === 'ARCHIVED') where.push('p.archived_at IS NOT NULL');
  if (f.status === 'ACTIVE') where.push('p.archived_at IS NULL');
  const sql = `SELECT * FROM (${SELECT}) p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY lower(p.name), p.id`;
  return (await pool.query<PropertyRow>(sql, params)).rows;
}

export const updateDetails = (
  id: string,
  f: { name?: string; description?: string | null; location?: string | null; is_active?: boolean; archived_at?: Date | null; project_id?: string | null; transaction_type?: string | null; property_type?: string | null; min_price?: number | null; max_price?: number | null; currency?: string; price_band?: string | null },
) => patchRow('properties', id, f);

export async function listExecutives(propertyId: string, db: Db = pool): Promise<PropertyExecutiveRow[]> {
  const { rows } = await db.query<PropertyExecutiveRow>(
    `SELECT u.id, u.name, u.username, u.is_active
     FROM property_executives pe JOIN users u ON u.id = pe.executive_id
     WHERE pe.property_id = $1 AND u.deleted_at IS NULL
     ORDER BY u.created_at, u.id`,
    [propertyId],
  );
  return rows;
}

/** Serialises concurrent edits of one property's executive list. */
export const lockForUpdate = (db: Db, propertyId: string) =>
  db.query('SELECT 1 FROM properties WHERE id = $1 FOR UPDATE', [propertyId]);

/** The property's executives that do NOT report to `managerId`: the part of the list that manager may not change. */
export async function listExecutiveIdsNotManagedBy(db: Db, propertyId: string, managerId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT u.id FROM property_executives pe JOIN users u ON u.id = pe.executive_id
     WHERE pe.property_id = $1 AND u.manager_id IS DISTINCT FROM $2::uuid`,
    [propertyId, managerId],
  );
  return rows.map((r) => r.id);
}

/** Replaces the property's executive list with exactly `executiveIds`. */
export async function replaceExecutives(db: Db, propertyId: string, executiveIds: string[]): Promise<void> {
  await db.query('DELETE FROM property_executives WHERE property_id = $1 AND NOT (executive_id = ANY($2::uuid[]))', [
    propertyId,
    executiveIds,
  ]);
  if (executiveIds.length) {
    await db.query(
      `INSERT INTO property_executives (property_id, executive_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [propertyId, executiveIds],
    );
  }
}
