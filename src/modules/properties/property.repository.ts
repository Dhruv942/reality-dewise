import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import { escapeLike } from '../teams/team.repository';
import type { PropertyRow, PropertySource } from './property.model';

const SELECT = `
  SELECT p.*, t.name AS team_name, t.is_active AS team_is_active,
         u.name AS primary_executive_name, u.is_active AS primary_executive_is_active
  FROM properties p
  LEFT JOIN teams t ON t.id = p.team_id
  LEFT JOIN users u ON u.id = p.primary_executive_id`;

export const findById = async (id: string): Promise<PropertyRow | null> =>
  (await pool.query<PropertyRow>(`${SELECT} WHERE p.id = $1`, [id])).rows[0] ?? null;

export async function list(f: {
  source?: PropertySource;
  teamId?: string;
  isActive?: boolean;
  search?: string;
}): Promise<PropertyRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.source) where.push(`p.source = $${params.push(f.source)}`);
  if (f.teamId) where.push(`p.team_id = $${params.push(f.teamId)}`);
  if (f.isActive !== undefined) where.push(`p.is_active = $${params.push(f.isActive)}`);
  if (f.search) {
    const s = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(p.name ILIKE ${s} OR p.location ILIKE ${s} OR p.external_property_id ILIKE ${s})`);
  }
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(p.name), p.id`;
  return (await pool.query<PropertyRow>(sql, params)).rows;
}

export async function insert(p: {
  externalPropertyId: string;
  source: PropertySource;
  name: string;
  description: string | null;
  location: string | null;
  teamId: string | null;
  primaryExecutiveId: string | null;
  isActive: boolean;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO properties
       (external_property_id, source, name, description, location, team_id, primary_executive_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [p.externalPropertyId, p.source, p.name, p.description, p.location, p.teamId, p.primaryExecutiveId, p.isActive],
  );
  return rows[0].id;
}

export const updateDetails = (
  id: string,
  f: { name?: string; description?: string | null; location?: string | null; is_active?: boolean },
) => patchRow('properties', id, f);

/** Team and primary executive change together in ONE statement so the composite FK never sees a half state. */
export const setAssignment = (id: string, f: { team_id?: string; primary_executive_id?: string | null }) =>
  patchRow('properties', id, f);

export async function countPrimaryFor(executiveId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM properties WHERE primary_executive_id = $1',
    [executiveId],
  );
  return rows[0].n;
}
