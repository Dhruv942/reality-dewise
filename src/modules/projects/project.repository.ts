import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';
import type { ProjectRow } from './project.model';

const select = `SELECT p.*, (SELECT count(*)::int FROM properties pr WHERE pr.project_id = p.id) AS property_count,
  (SELECT count(*)::int FROM inventory i JOIN properties pr ON pr.id = i.property_id WHERE pr.project_id = p.id) AS inventory_count
  FROM projects p`;

export async function list(f: { status?: string; search?: string; limit: number; offset: number }): Promise<ProjectRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.status) where.push(`p.status = $${params.push(f.status)}`);
  if (f.search) {
    const searchParam = `$${params.push(`%${f.search.replace(/[%_\\]/g, '\\$&')}%`)}`;
    where.push(`(p.name ILIKE ${searchParam} ESCAPE '\\' OR p.project_code ILIKE ${searchParam} ESCAPE '\\')`);
  }
  params.push(f.limit, f.offset);
  const sql = `${select} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY lower(p.name), p.id LIMIT $${params.length - 1} OFFSET $${params.length}`;
  return (await pool.query<ProjectRow>(sql, params)).rows;
}

export const findById = async (id: string, db: Db = pool) => (await db.query<ProjectRow>(`${select} WHERE p.id = $1`, [id])).rows[0] ?? null;

export async function details(id: string) {
  const project = await findById(id);
  if (!project) return null;
  const properties = (await pool.query(`SELECT id, name, location, is_active, is_stub, transaction_type, property_type, min_price, max_price, currency, price_band,
    (SELECT count(*)::int FROM inventory i WHERE i.property_id = p.id) AS inventory_count
    FROM properties p WHERE p.project_id = $1 ORDER BY lower(name), id`, [id])).rows;
  return { project, properties };
}

export async function insert(db: Db, input: { name: string; description?: string | null; location?: string | null; createdBy: string }) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO projects (project_code, name, description, location, created_by)
     VALUES ('PRJ-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('projects_code_seq')::text, 6, '0'), $1, $2, $3, $4) RETURNING id`,
    [input.name, input.description ?? null, input.location ?? null, input.createdBy],
  );
  return rows[0].id;
}

export const update = (id: string, input: { name?: string; description?: string | null; location?: string | null }) =>
  pool.query(`UPDATE projects SET name = COALESCE($2, name), description = CASE WHEN $3::boolean THEN $4 ELSE description END,
    location = CASE WHEN $5::boolean THEN $6 ELSE location END WHERE id = $1`, [id, input.name ?? null, input.description !== undefined, input.description ?? null, input.location !== undefined, input.location ?? null]);

export const archive = (id: string) => pool.query("UPDATE projects SET status = 'ARCHIVED' WHERE id = $1 AND status = 'ACTIVE'", [id]);
