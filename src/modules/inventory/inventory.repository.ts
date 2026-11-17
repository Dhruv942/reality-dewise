import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';
import type { InventoryRow } from './inventory.model';

const select = `SELECT i.*, p.name AS property_name, p.location AS property_location, p.project_id,
  pr.project_code, pr.name AS project_name FROM inventory i JOIN properties p ON p.id = i.property_id
  LEFT JOIN projects pr ON pr.id = p.project_id`;

export async function list(f: { propertyId?: string; projectId?: string; status?: string; transactionType?: string; propertyType?: string; priceBand?: string; search?: string; limit: number; offset: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.propertyId) where.push(`i.property_id = $${params.push(f.propertyId)}`);
  if (f.projectId) where.push(`p.project_id = $${params.push(f.projectId)}`);
  if (f.status) where.push(`i.status = $${params.push(f.status)}`);
  if (f.transactionType) where.push(`i.transaction_type = $${params.push(f.transactionType)}`);
  if (f.propertyType) where.push(`i.property_type = $${params.push(f.propertyType)}`);
  if (f.priceBand) where.push(`i.price_band = $${params.push(f.priceBand)}`);
  if (f.search) {
    const param = `$${params.push(`%${f.search.replace(/[%_\\]/g, '\\$&')}%`)}`;
    where.push(`(i.name ILIKE ${param} ESCAPE '\\' OR i.inventory_code ILIKE ${param} ESCAPE '\\' OR p.name ILIKE ${param} ESCAPE '\\')`);
  }
  params.push(f.limit, f.offset);
  const sql = `${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.created_at DESC, i.id LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await pool.query<InventoryRow>(sql, params)).rows;
}

export const findById = async (id: string, db: Db = pool) => (await db.query<InventoryRow>(`${select} WHERE i.id = $1`, [id])).rows[0] ?? null;

export async function lockProperty(db: Db, propertyId: string) {
  return (await db.query<{ id: string; is_active: boolean; archived_at: Date | null; project_id: string | null; transaction_type: string | null; property_type: string | null }>(
    `SELECT id, is_active, archived_at, project_id, transaction_type, property_type FROM properties WHERE id = $1 FOR SHARE`, [propertyId],
  )).rows[0] ?? null;
}

export async function projectStatus(db: Db, projectId: string) {
  return (await db.query<{ status: string }>('SELECT status FROM projects WHERE id = $1 FOR SHARE', [projectId])).rows[0] ?? null;
}

export async function insert(db: Db, input: { propertyId: string; name: string; description?: string | null; location?: string | null; transactionType: string | null; propertyType: string | null; minPrice?: number | null; maxPrice?: number | null; currency: string; priceBand: string; availableFrom?: string | null; createdBy: string }) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO inventory (inventory_code, property_id, name, description, location, transaction_type, property_type, min_price, max_price, currency, price_band, available_from, created_by)
     VALUES (to_char(current_date, 'YY') || lpad(nextval('inventory_code_seq')::text, 8, '0'), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
    [input.propertyId, input.name, input.description ?? null, input.location ?? null, input.transactionType, input.propertyType, input.minPrice ?? null, input.maxPrice ?? null, input.currency, input.priceBand, input.availableFrom ?? null, input.createdBy],
  );
  return rows[0].id;
}

export const update = (id: string, input: Record<string, unknown>) => {
  const entries = Object.entries(input).filter(([, value]) => value !== undefined);
  if (!entries.length) return Promise.resolve();
  const sets = entries.map(([key], index) => `${key} = $${index + 2}`).join(', ');
  return pool.query(`UPDATE inventory SET ${sets} WHERE id = $1`, [id, ...entries.map(([, value]) => value)]).then(() => undefined);
};

export const setStatus = (id: string, status: string, archivedAt: Date | null) => pool.query('UPDATE inventory SET status = $2, archived_at = $3 WHERE id = $1', [id, status, archivedAt]);
