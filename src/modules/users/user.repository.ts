import { pool } from '../../database/pool';
import type { UserRecord, UserRole } from './user.model';

export const findByEmail = async (email: string): Promise<UserRecord | null> =>
  (await pool.query<UserRecord>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])).rows[0] ?? null;

export const findById = async (id: string): Promise<UserRecord | null> =>
  (await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1', [id])).rows[0] ?? null;

export interface NewUser {
  name: string;
  email: string;
  username: string;
  phone?: string | null;
  passwordHash: string;
  role: UserRole;
}

/** Idempotent on email: re-running updates name/role/password/phone and re-activates (and un-deletes) the user. */
export async function upsertByEmail(u: NewUser): Promise<UserRecord> {
  const { rows } = await pool.query<UserRecord>(
    `INSERT INTO users (name, email, username, phone, password_hash, role)
     VALUES ($1, lower($2), lower($3), $4, $5, $6)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, username = EXCLUDED.username, phone = EXCLUDED.phone,
           password_hash = EXCLUDED.password_hash, password_changed_at = now(), role = EXCLUDED.role, is_active = true, deleted_at = NULL
     RETURNING *`,
    [u.name, u.email, u.username, u.phone ?? null, u.passwordHash, u.role],
  );
  return rows[0];
}
