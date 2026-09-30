import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import { escapeLike } from '../teams/team.repository';
import type { ExecutiveRow } from './executive.model';

const SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.username, u.role, u.is_active, u.team_id,
         u.created_at, u.updated_at, u.deleted_at,
         t.name AS team_name, t.is_active AS team_is_active
  FROM users u LEFT JOIN teams t ON t.id = u.team_id`;

/** Any role, including soft-deleted: the service decides how to treat them. */
export const findById = async (id: string): Promise<ExecutiveRow | null> =>
  (await pool.query<ExecutiveRow>(`${SELECT} WHERE u.id = $1`, [id])).rows[0] ?? null;

/** Live (non soft-deleted) executives only. */
export async function list(f: { teamId?: string; isActive?: boolean; search?: string }): Promise<ExecutiveRow[]> {
  const where = [`u.role = 'EXECUTIVE'`, 'u.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (f.teamId) where.push(`u.team_id = $${params.push(f.teamId)}`);
  if (f.isActive !== undefined) where.push(`u.is_active = $${params.push(f.isActive)}`);
  if (f.search) {
    const p = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR u.username ILIKE ${p} OR u.phone ILIKE ${p})`);
  }
  return (await pool.query<ExecutiveRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY lower(u.name), u.id`, params)).rows;
}

export async function insert(e: {
  name: string;
  email: string;
  phone: string | null;
  username: string;
  passwordHash: string;
  teamId: string | null;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, phone, username, password_hash, role, team_id)
     VALUES ($1, $2, $3, $4, $5, 'EXECUTIVE', $6) RETURNING id`,
    [e.name, e.email, e.phone, e.username, e.passwordHash, e.teamId],
  );
  return rows[0].id;
}

export const updateProfile = (
  id: string,
  f: { name?: string; email?: string; phone?: string | null; username?: string; team_id?: string | null },
) => patchRow('users', id, f);

export const setPasswordHash = (id: string, hash: string) => patchRow('users', id, { password_hash: hash });
export const setActive = (id: string, isActive: boolean) => patchRow('users', id, { is_active: isActive });
export const setTeam = (id: string, teamId: string | null) => patchRow('users', id, { team_id: teamId });

/** Soft delete: deactivates and stamps deleted_at. The row (and its team_id) is kept for history. */
export const softDelete = async (id: string): Promise<void> => {
  await pool.query('UPDATE users SET is_active = false, deleted_at = now() WHERE id = $1', [id]);
};
