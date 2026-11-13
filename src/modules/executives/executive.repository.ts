import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import { escapeLike } from '../../utils/like';
import type { UserDesignation, UserRole } from '../users/user.model';
import type { ExecutiveRow } from './executive.model';

const SELECT = `
  SELECT u.id, u.name, u.email, u.phone, u.username, u.role, u.designation, u.is_active, u.manager_id,
         u.created_at, u.updated_at, u.deleted_at,
         m.name AS manager_name, m.is_active AS manager_is_active
  FROM users u LEFT JOIN users m ON m.id = u.manager_id`;

/** Any role, including soft-deleted: the service decides how to treat them. */
export const findById = async (id: string): Promise<ExecutiveRow | null> =>
  (await pool.query<ExecutiveRow>(`${SELECT} WHERE u.id = $1`, [id])).rows[0] ?? null;

/** Live (non soft-deleted) users of one role (sales executives by default). `managerId` = only the sales users that report to that manager. */
export async function list(f: {
  role?: UserRole;
  managerId?: string;
  isActive?: boolean;
  search?: string;
}): Promise<ExecutiveRow[]> {
  const params: unknown[] = [f.role ?? 'SALES'];
  const where = ['u.role = $1', 'u.deleted_at IS NULL'];
  if (f.managerId) where.push(`u.manager_id = $${params.push(f.managerId)}`);
  if (f.isActive !== undefined) where.push(`u.is_active = $${params.push(f.isActive)}`);
  if (f.search) {
    const p = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(u.name ILIKE ${p} OR u.email ILIKE ${p} OR u.username ILIKE ${p} OR u.phone ILIKE ${p})`);
  }
  return (await pool.query<ExecutiveRow>(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY lower(u.name), u.id`, params)).rows;
}

export async function insert(e: {
  role: UserRole;
  designation: UserDesignation;
  name: string;
  email: string;
  phone: string | null;
  username: string;
  passwordHash: string;
  managerId: string | null;
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (name, email, phone, username, password_hash, role, designation, manager_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [e.name, e.email, e.phone, e.username, e.passwordHash, e.role, e.designation, e.managerId],
  );
  return rows[0].id;
}

export const updateProfile = (
  id: string,
  f: { name?: string; email?: string; phone?: string | null; username?: string; designation?: UserDesignation; manager_id?: string | null },
) => patchRow('users', id, f);

/** Also stamps password_changed_at: tokens issued before it stop working. */
export const setPasswordHash = (id: string, hash: string) =>
  patchRow('users', id, { password_hash: hash, password_changed_at: new Date() });
export const setActive = (id: string, isActive: boolean) => patchRow('users', id, { is_active: isActive });
export const setManager = (id: string, managerId: string | null) => patchRow('users', id, { manager_id: managerId });

/** Soft delete: deactivates and stamps deleted_at. The row (and its manager_id) is kept for history. */
export const softDelete = async (id: string): Promise<void> => {
  await pool.query('UPDATE users SET is_active = false, deleted_at = now() WHERE id = $1', [id]);
};

/** A manager who is soft-deleted stops looking after their sales users (they stay, without a manager). */
export const clearManagerFrom = async (managerId: string): Promise<void> => {
  await pool.query('UPDATE users SET manager_id = NULL WHERE manager_id = $1', [managerId]);
};
