import { pool } from '../../database/pool';
import { escapeLike } from '../../utils/like';
import type { NoteRow } from './note.model';

const COLUMNS = 'id, user_id, title, content, created_at, updated_at';

export async function insert(userId: string, n: { title: string; content: string }): Promise<NoteRow> {
  const { rows } = await pool.query<NoteRow>(
    `INSERT INTO personal_notes (user_id, title, content) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [userId, n.title, n.content],
  );
  return rows[0];
}

export async function findOwned(userId: string, id: string): Promise<NoteRow | null> {
  const { rows } = await pool.query<NoteRow>(`SELECT ${COLUMNS} FROM personal_notes WHERE id = $1 AND user_id = $2`, [id, userId]);
  return rows[0] ?? null;
}

export async function listOwned(userId: string, f: { search?: string; limit: number; offset: number }): Promise<NoteRow[]> {
  const params: unknown[] = [userId];
  const where = ['user_id = $1'];
  if (f.search) {
    const p = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(title ILIKE ${p} OR content ILIKE ${p})`);
  }
  const lim = `$${params.push(f.limit)}`;
  const off = `$${params.push(f.offset)}`;
  const { rows } = await pool.query<NoteRow>(
    `SELECT ${COLUMNS} FROM personal_notes WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ${lim} OFFSET ${off}`,
    params,
  );
  return rows;
}

export async function updateOwned(userId: string, id: string, f: { title?: string; content?: string }): Promise<NoteRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, userId];
  if (f.title !== undefined) sets.push(`title = $${params.push(f.title)}`);
  if (f.content !== undefined) sets.push(`content = $${params.push(f.content)}`);
  if (sets.length === 0) return findOwned(userId, id);
  const { rows } = await pool.query<NoteRow>(
    `UPDATE personal_notes SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteOwned(userId: string, id: string): Promise<boolean> {
  const r = await pool.query('DELETE FROM personal_notes WHERE id = $1 AND user_id = $2', [id, userId]);
  return (r.rowCount ?? 0) > 0;
}
