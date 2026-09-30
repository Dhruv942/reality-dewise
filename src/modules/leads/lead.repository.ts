import { pool } from '../../database/pool';
import { patchRow } from '../../database/patch';
import type { Db } from '../../database/transaction';
import { escapeLike } from '../teams/team.repository';
import type { PropertySource } from '../properties/property.model';
import type { LeadRow, LeadStatus } from './lead.model';

export const LEAD_EXTERNAL_UNIQUE = 'leads_source_external_lead_id_key';

const SELECT = `
  SELECT l.id, l.status, l.message, l.external_lead_id, l.source, l.created_at, l.updated_at,
         c.id AS customer_id, c.name AS customer_name, c.mobile AS customer_mobile, c.email AS customer_email,
         p.id AS property_id, p.name AS property_name, p.external_property_id, p.location AS property_location,
         u.id AS executive_id, u.name AS executive_name,
         h.assignment_type, h.reason AS assignment_reason
  FROM leads l
  JOIN customers c ON c.id = l.customer_id
  JOIN properties p ON p.id = l.property_id
  LEFT JOIN users u ON u.id = l.assigned_executive_id
  LEFT JOIN property_assignment_history h ON h.lead_id = l.id`;

/** `ownerId` scopes the lookup to one executive's leads (others look like "not found"). */
export async function findById(id: string, ownerId?: string): Promise<LeadRow | null> {
  const params: unknown[] = [id];
  let sql = `${SELECT} WHERE l.id = $1`;
  if (ownerId) sql += ` AND l.assigned_executive_id = $${params.push(ownerId)}`;
  return (await pool.query<LeadRow>(sql, params)).rows[0] ?? null;
}

export async function findByExternalId(source: PropertySource, externalLeadId: string): Promise<LeadRow | null> {
  return (
    (await pool.query<LeadRow>(`${SELECT} WHERE l.source = $1 AND l.external_lead_id = $2`, [source, externalLeadId]))
      .rows[0] ?? null
  );
}

export interface LeadFilters {
  status?: LeadStatus;
  propertyId?: string;
  executiveId?: string;
  customerId?: string;
  search?: string;
  limit: number;
  offset: number;
}

export async function list(f: LeadFilters): Promise<LeadRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) where.push(`l.status = $${params.push(f.status)}`);
  if (f.propertyId) where.push(`l.property_id = $${params.push(f.propertyId)}`);
  if (f.executiveId) where.push(`l.assigned_executive_id = $${params.push(f.executiveId)}`);
  if (f.customerId) where.push(`l.customer_id = $${params.push(f.customerId)}`);
  if (f.search) {
    const s = `$${params.push(`%${escapeLike(f.search)}%`)}`;
    where.push(`(c.name ILIKE ${s} OR c.mobile ILIKE ${s} OR c.email ILIKE ${s} OR p.name ILIKE ${s})`);
  }
  const lim = `$${params.push(f.limit)}`;
  const off = `$${params.push(f.offset)}`;
  const sql = `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY l.created_at DESC, l.id LIMIT ${lim} OFFSET ${off}`;
  return (await pool.query<LeadRow>(sql, params)).rows;
}

export async function insert(
  db: Db,
  l: {
    customerId: string;
    propertyId: string;
    source: PropertySource;
    message: string | null;
    externalLeadId: string | null;
    rawPayload: unknown;
  },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO leads (customer_id, property_id, source, message, external_lead_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [l.customerId, l.propertyId, l.source, l.message, l.externalLeadId, l.rawPayload ?? null],
  );
  return rows[0].id;
}

export const setAssignedExecutive = async (db: Db, leadId: string, executiveId: string): Promise<void> => {
  await db.query('UPDATE leads SET assigned_executive_id = $2 WHERE id = $1', [leadId, executiveId]);
};

export const setStatus = (id: string, status: LeadStatus) => patchRow('leads', id, { status });
