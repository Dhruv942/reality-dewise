import { Db, query, queryOne } from '../db/pool';
import type { Customer } from '../models/types';
import { Pagination, offsetOf } from '../utils/pagination';

export const customerRepository = {
  /** Returns the new row, or null when the mobile already exists (race-safe: relies on the UNIQUE constraint). */
  async insertIgnoreDuplicate(db: Db, d: { name: string; mobile: string; email?: string | null }): Promise<Customer | null> {
    return queryOne<Customer>(db,
      `INSERT INTO customers (name, mobile, email) VALUES ($1, $2, $3)
       ON CONFLICT (mobile) DO NOTHING RETURNING *`, [d.name, d.mobile, d.email ?? null]);
  },

  /** Revives a soft-deleted customer and back-fills a missing email; never overwrites the existing name. */
  async touchExisting(db: Db, mobile: string, email?: string | null): Promise<Customer> {
    return (await queryOne<Customer>(db,
      `UPDATE customers SET email = COALESCE(email, $2), deleted_at = NULL WHERE mobile = $1 RETURNING *`,
      [mobile, email ?? null]))!;
  },

  findById: (db: Db, id: number) =>
    queryOne<Customer>(db, `SELECT * FROM customers WHERE id = $1 AND deleted_at IS NULL`, [id]),

  findByMobile: (db: Db, mobile: string) =>
    queryOne<Customer>(db, `SELECT * FROM customers WHERE mobile = $1 AND deleted_at IS NULL`, [mobile]),

  list(db: Db, p: Pagination, search?: string) {
    return query<Customer & { totalCount: number }>(db,
      `SELECT *, count(*) OVER () AS total_count FROM customers
       WHERE deleted_at IS NULL AND ($1::text IS NULL OR mobile LIKE $1 || '%' OR name ILIKE '%' || $1 || '%')
       ORDER BY id DESC LIMIT $2 OFFSET $3`, [search ?? null, p.limit, offsetOf(p)]);
  },
};
