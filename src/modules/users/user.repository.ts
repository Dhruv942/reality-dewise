import { pool } from '../../database/pool';
import type { UserDesignation, UserRecord, UserRole } from './user.model';

export const findByEmail = async (email: string): Promise<UserRecord | null> =>
  (await pool.query<UserRecord>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])).rows[0] ?? null;

export const findByUsername = async (username: string): Promise<UserRecord | null> =>
  (await pool.query<UserRecord>('SELECT * FROM users WHERE username = $1', [username.toLowerCase()])).rows[0] ?? null;

export const findById = async (id: string): Promise<UserRecord | null> =>
  (await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1', [id])).rows[0] ?? null;

export interface NewUser {
  name: string;
  email: string;
  username: string;
  phone?: string | null;
  passwordHash: string;
  role: UserRole;
  designation?: UserDesignation | null;
}

/** Idempotent on email: re-running updates name/role/password/phone and re-activates (and un-deletes) the user. */
export async function upsertByEmail(u: NewUser): Promise<UserRecord> {
  const { rows } = await pool.query<UserRecord>(
    `INSERT INTO users (name, email, username, phone, password_hash, role, designation)
     VALUES ($1, lower($2), lower($3), $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, username = EXCLUDED.username, phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash, password_changed_at = now(), role = EXCLUDED.role, designation = EXCLUDED.designation, is_active = true, deleted_at = NULL
     RETURNING *`,
    [u.name, u.email, u.username, u.phone ?? null, u.passwordHash, u.role, u.designation ?? (u.role === 'SALES' ? 'SALES_EXECUTIVE' : u.role === 'MANAGER' ? 'MANAGER' : null)],
  );
  return rows[0];
}
