import { Db, query, queryOne } from '../db/pool';
import type { Enquiry } from '../models/types';
import { Pagination, offsetOf } from '../utils/pagination';

export const enquiryRepository = {
  findById: (db: Db, id: number) =>
    queryOne<Enquiry & { leadId: number | null }>(db,
      `SELECT e.*, l.id AS lead_id FROM enquiries e LEFT JOIN leads l ON l.enquiry_id = e.id
       WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]),

  lockById: (db: Db, id: number) =>
    queryOne<Enquiry>(db, `SELECT * FROM enquiries WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]),

  list: (db: Db, f: { status?: string; projectId?: number; mobile?: string }, p: Pagination) =>
    query<any>(db,
      `SELECT e.*, l.id AS lead_id, count(*) OVER () AS total_count
       FROM enquiries e LEFT JOIN leads l ON l.enquiry_id = e.id
       WHERE e.deleted_at IS NULL AND ($1::enquiry_status IS NULL OR e.status = $1)
         AND ($2::bigint IS NULL OR e.project_id = $2) AND ($3::text IS NULL OR e.mobile = $3)
       ORDER BY e.id DESC LIMIT $4 OFFSET $5`,
      [f.status ?? null, f.projectId ?? null, f.mobile ?? null, p.limit, offsetOf(p)]),

  async markConverted(db: Db, id: number, customerId: number) {
    await db.query(`UPDATE enquiries SET status = 'CONVERTED', customer_id = $2, converted_at = now() WHERE id = $1`, [id, customerId]);
  },
};
