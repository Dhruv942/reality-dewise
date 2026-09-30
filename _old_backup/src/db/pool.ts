import pg, { Pool, PoolClient } from 'pg';
import { env } from '../config/env';

// bigint (int8) and numeric come back as strings by default; ids/counts/prices fit safely in a JS number.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new Pool({ connectionString: env.DATABASE_URL });

/** Either the pool or a transaction client; repositories accept both. */
export type Db = Pool | PoolClient;

const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

function camelize<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out as T;
}

export async function query<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows.map((r) => camelize<T>(r));
}

export async function queryOne<T = any>(db: Db, text: string, params: unknown[] = []): Promise<T | null> {
  return (await query<T>(db, text, params))[0] ?? null;
}

export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// --- tiny helpers for plain single-table CRUD. Table names are constants in code and column
// --- names come from zod-validated (whitelisted) keys, never from raw request input.

export async function insertRow<T>(db: Db, table: string, data: Record<string, unknown>): Promise<T> {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const cols = entries.map(([k]) => snake(k));
  const vals = entries.map(([, v]) => v);
  const ph = vals.map((_, i) => `$${i + 1}`);
  const row = await queryOne<T>(db, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`, vals);
  return row as T;
}

export async function updateRow<T>(db: Db, table: string, id: number, patch: Record<string, unknown>, softDeletable = true): Promise<T | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const guard = softDeletable ? ' AND deleted_at IS NULL' : '';
  if (entries.length === 0) return queryOne<T>(db, `SELECT * FROM ${table} WHERE id = $1${guard}`, [id]);
  const sets = entries.map(([k], i) => `${snake(k)} = $${i + 2}`);
  return queryOne<T>(db, `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1${guard} RETURNING *`, [id, ...entries.map(([, v]) => v)]);
}

export async function softDeleteRow(db: Db, table: string, id: number): Promise<boolean> {
  const rows = await query(db, `UPDATE ${table} SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`, [id]);
  return rows.length > 0;
}
