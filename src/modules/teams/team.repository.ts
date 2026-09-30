import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import type { TeamRecord, TeamWithCount } from './team.model';

const WITH_COUNT = `
  SELECT t.*,
    (SELECT count(*)::int FROM users u
      WHERE u.team_id = t.id AND u.role = 'EXECUTIVE' AND u.is_active AND u.deleted_at IS NULL) AS executive_count
  FROM teams t`;

export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, '\\$&');

export async function list(f: { isActive?: boolean; search?: string }): Promise<TeamWithCount[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.isActive !== undefined) where.push(`t.is_active = $${params.push(f.isActive)}`);
  if (f.search) where.push(`t.name ILIKE $${params.push(`%${escapeLike(f.search)}%`)}`);
  const sql = `${WITH_COUNT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(t.name)`;
  return (await pool.query<TeamWithCount>(sql, params)).rows;
}

export const findById = async (id: string): Promise<TeamWithCount | null> =>
  (await pool.query<TeamWithCount>(`${WITH_COUNT} WHERE t.id = $1`, [id])).rows[0] ?? null;

export async function create(name: string, description: string | null): Promise<string> {
  const { rows } = await pool.query<TeamRecord>('INSERT INTO teams (name, description) VALUES ($1, $2) RETURNING id', [
    name,
    description,
  ]);
  return rows[0].id;
}

export const update = (id: string, fields: { name?: string; description?: string | null }) => patchRow('teams', id, fields);
export const setActive = (id: string, isActive: boolean) => patchRow('teams', id, { is_active: isActive });
