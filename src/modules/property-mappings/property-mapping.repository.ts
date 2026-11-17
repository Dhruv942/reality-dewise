import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';
import type { PropertyMappingRow } from './property-mapping.model';

const select = `SELECT m.*, p.name AS property_name FROM portal_property_mappings m JOIN properties p ON p.id = m.property_id`;

export async function list(f: { propertyId?: string; portalSource?: string; externalPropertyId?: string; status?: string; search?: string; limit: number; offset: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.propertyId) where.push(`m.property_id = $${params.push(f.propertyId)}`);
  if (f.portalSource) where.push(`m.portal_source = $${params.push(f.portalSource)}`);
  if (f.externalPropertyId) where.push(`m.external_property_id = $${params.push(f.externalPropertyId)}`);
  if (f.status) where.push(`m.is_active = $${params.push(f.status === 'ACTIVE')}`);
  if (f.search) {
    const param = `$${params.push(`%${f.search.replace(/[%_\\]/g, '\\$&')}%`)}`;
    where.push(`(m.external_property_name ILIKE ${param} ESCAPE '\\' OR m.normalized_property_name ILIKE ${param} ESCAPE '\\' OR p.name ILIKE ${param} ESCAPE '\\')`);
  }
  params.push(f.limit, f.offset);
  const sql = `${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.created_at DESC, m.id LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await pool.query<PropertyMappingRow>(sql, params)).rows;
}

export const findById = async (id: string, db: Db = pool) => (await db.query<PropertyMappingRow>(`${select} WHERE m.id = $1`, [id])).rows[0] ?? null;
export const findActiveByExternalId = async (source: string, externalId: string, db: Db = pool) => (await db.query<PropertyMappingRow>(`${select} WHERE m.portal_source = $1 AND m.external_property_id = $2 AND m.is_active`, [source, externalId])).rows[0] ?? null;
export const findActiveByName = async (source: string, normalizedName: string, db: Db = pool) => (await db.query<PropertyMappingRow>(`${select} WHERE m.portal_source = $1 AND m.normalized_property_name = $2 AND m.is_active`, [source, normalizedName])).rows;
export const listForProperty = async (propertyId: string, db: Db = pool) => (await db.query<PropertyMappingRow>(`${select} WHERE m.property_id = $1 ORDER BY m.created_at DESC, m.id`, [propertyId])).rows;

export async function insert(db: Db, input: { propertyId: string; source: string; externalId: string | null; externalName: string | null; normalizedName: string; url: string | null; actorId: string | null }) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO portal_property_mappings (property_id, portal_source, external_property_id, external_property_name, normalized_property_name, external_listing_url, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [input.propertyId, input.source, input.externalId, input.externalName, input.normalizedName, input.url, input.actorId],
  );
  return rows[0].id;
}

/** Best-effort registration for an unresolved portal listing. Unique constraints make retries safe. */
export async function insertIfAbsent(db: Db, input: { propertyId: string; source: string; externalId: string | null; externalName: string | null; normalizedName: string; url: string | null; actorId: string | null }) {
  await db.query(
    `INSERT INTO portal_property_mappings (property_id, portal_source, external_property_id, external_property_name, normalized_property_name, external_listing_url, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT DO NOTHING`,
    [input.propertyId, input.source, input.externalId, input.externalName, input.normalizedName, input.url, input.actorId],
  );
}

/** Explicit manual resolution may move a placeholder mapping to the verified property. */
export async function reassignActiveExternalId(db: Db, input: { source: string; externalId: string; propertyId: string; externalName: string | null; normalizedName: string; url: string | null; actorId: string }) {
  const result = await db.query(
    `UPDATE portal_property_mappings SET property_id = $3, external_property_name = COALESCE($4, external_property_name), normalized_property_name = $5,
       external_listing_url = COALESCE($6, external_listing_url), updated_by = $7
     WHERE portal_source = $1 AND external_property_id = $2 AND is_active`,
    [input.source, input.externalId, input.propertyId, input.externalName, input.normalizedName, input.url, input.actorId],
  );
  return (result.rowCount ?? 0) > 0;
}

export const update = (id: string, input: { propertyId?: string; source?: string; externalId?: string | null; externalName?: string | null; normalizedName?: string; url?: string | null; isActive?: boolean; actorId: string }) =>
  pool.query(`UPDATE portal_property_mappings SET property_id = COALESCE($2, property_id), portal_source = COALESCE($3, portal_source), external_property_id = CASE WHEN $4::boolean THEN $5 ELSE external_property_id END,
    external_property_name = CASE WHEN $6::boolean THEN $7 ELSE external_property_name END, normalized_property_name = COALESCE($8, normalized_property_name), external_listing_url = CASE WHEN $9::boolean THEN $10 ELSE external_listing_url END,
    is_active = COALESCE($11, is_active), updated_by = $12 WHERE id = $1`,
    [id, input.propertyId ?? null, input.source ?? null, input.externalId !== undefined, input.externalId ?? null, input.externalName !== undefined, input.externalName ?? null, input.normalizedName ?? null, input.url !== undefined, input.url ?? null, input.isActive ?? null, input.actorId]);
