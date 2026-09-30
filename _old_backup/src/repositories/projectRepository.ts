import { Db, query, queryOne } from '../db/pool';
import type { Project } from '../models/types';

export const projectRepository = {
  findById: (db: Db, id: number) => queryOne<Project>(db, `SELECT * FROM projects WHERE id = $1 AND deleted_at IS NULL`, [id]),

  findByName: (db: Db, name: string) =>
    queryOne<Project>(db, `SELECT * FROM projects WHERE lower(name) = lower($1) AND deleted_at IS NULL`, [name.trim()]),

  list: (db: Db, f: { status?: string; teamId?: number }) =>
    query<Project>(db,
      `SELECT * FROM projects WHERE deleted_at IS NULL
         AND ($1::project_status IS NULL OR status = $1) AND ($2::bigint IS NULL OR team_id = $2) ORDER BY id`,
      [f.status ?? null, f.teamId ?? null]),
};
