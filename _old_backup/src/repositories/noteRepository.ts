import { Db, insertRow, query } from '../db/pool';

export const noteRepository = {
  insert: (db: Db, n: { leadId: number; authorId?: number | null; note: string }) => insertRow(db, 'lead_notes', n),

  listByLead: (db: Db, leadId: number) =>
    query(db,
      `SELECT n.*, u.name AS author_name FROM lead_notes n LEFT JOIN users u ON u.id = n.author_id
       WHERE n.lead_id = $1 ORDER BY n.id DESC`, [leadId]),
};
