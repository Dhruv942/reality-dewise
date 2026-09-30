import { Db, query, queryOne } from '../db/pool';
import type { Enquiry, Property } from '../models/types';

export const propertyRepository = {
  findById: (db: Db, id: number) => queryOne<Property>(db, `SELECT * FROM properties WHERE id = $1 AND deleted_at IS NULL`, [id]),

  lockById: (db: Db, id: number) =>
    queryOne<Property>(db, `SELECT * FROM properties WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]),

  list: (db: Db, f: { projectId?: number; bhk?: number; availability?: string; maxPrice?: number }) =>
    query<Property>(db,
      `SELECT * FROM properties WHERE deleted_at IS NULL
         AND ($1::bigint IS NULL OR project_id = $1) AND ($2::int IS NULL OR bhk = $2)
         AND ($3::availability_status IS NULL OR availability = $3) AND ($4::numeric IS NULL OR price <= $4)
       ORDER BY project_id, price`,
      [f.projectId ?? null, f.bhk ?? null, f.availability ?? null, f.maxPrice ?? null]),

  /** Available inventory that fits a pending enquiry (project / BHK / budget, each applied only if the enquiry states it). */
  matchesFor: (db: Db, e: Enquiry) =>
    query<Property>(db,
      `SELECT * FROM properties WHERE deleted_at IS NULL AND availability = 'AVAILABLE'
         AND ($1::bigint IS NULL OR project_id = $1) AND ($2::int IS NULL OR bhk = $2) AND ($3::numeric IS NULL OR price <= $3)
       ORDER BY price LIMIT 20`, [e.projectId, e.bhk, e.budget]),
};
