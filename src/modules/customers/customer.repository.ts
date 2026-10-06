import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import type { Db } from '../../database/transaction';
import { escapeLike } from '../teams/team.repository';
import type { CustomerRow, CustomerType } from './customer.model';

/**
 * One customer per mobile number. An existing customer keeps their name; a missing email is
 * filled in if this enquiry supplies one. `type` only applies when the customer is first created.
 */
export async function upsertByMobile(
  db: Db,
  c: { name: string; mobile: string; email: string | null; type?: CustomerType },
): Promise<CustomerRow> {
  const { rows } = await db.query<CustomerRow>(
    `INSERT INTO customers (name, mobile, email, type) VALUES ($1, $2, $3, $4)
     ON CONFLICT (mobile) DO UPDATE SET email = COALESCE(customers.email, EXCLUDED.email)
     RETURNING *`,
    [c.name, c.mobile, c.email, c.type ?? 'INDIVIDUAL'],
  );
  return rows[0];
}

export const findById = async (id: string): Promise<CustomerRow | null> =>
  (await pool.query<CustomerRow>('SELECT * FROM customers WHERE id = $1', [id])).rows[0] ?? null;

export async function list(f: { search?: string; limit: number; offset: number }): Promise<CustomerRow[]> {
  const params: unknown[] = [];
  let where = '';
  if (f.search) {
    const p = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where = `WHERE name ILIKE ${p} OR mobile ILIKE ${p} OR email ILIKE ${p}`;
  }
  const lim = `$${params.push(f.limit)}`;
  const off = `$${params.push(f.offset)}`;
  return (
    await pool.query<CustomerRow>(
      `SELECT * FROM customers ${where} ORDER BY created_at DESC, id LIMIT ${lim} OFFSET ${off}`,
      params,
    )
  ).rows;
}

export const update = (id: string, f: { name?: string; email?: string | null }) => patchRow('customers', id, f);
