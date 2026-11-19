import { pool } from '../../database/pool';
import { priceBandSql } from '../catalog/catalog.policy';
import type { BreakdownRow, LeadReportRow, ReportFilters, ReportScope } from './report.model';

type ParamList = unknown[];

function add(params: ParamList, value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

function dateRange(filters: ReportFilters, params: ParamList, column = 'l.created_at') {
  const where: string[] = [];
  if (filters.fromDate) where.push(`${column} >= (${add(params, filters.fromDate)}::date AT TIME ZONE ${add(params, filters.tz)})`);
  if (filters.toDate) where.push(`${column} < ((${add(params, filters.toDate)}::date + interval '1 day') AT TIME ZONE ${add(params, filters.tz)})`);
  return where;
}

function scope(scope: ReportScope, params: ParamList) {
  if (scope.role === 'SALES') return [`l.assigned_executive_id = ${add(params, scope.executiveId)}`];
  if (scope.role === 'MANAGER') {
    const manager = add(params, scope.managerId);
    return [`(e.manager_id = ${manager} OR (l.assigned_executive_id IS NULL AND (l.property_review_manager_id IS NULL OR l.property_review_manager_id = ${manager})))`];
  }
  return [];
}

function predicates(filters: ReportFilters, scopeInfo: ReportScope, params: ParamList, dateColumn = 'l.created_at') {
  const where = [...scope(scopeInfo, params), ...dateRange(filters, params, dateColumn)];
  if (filters.managerId && scopeInfo.role === 'ADMIN') where.push(`e.manager_id = ${add(params, filters.managerId)}`);
  if (filters.executiveId && scopeInfo.role !== 'SALES') where.push(`l.assigned_executive_id = ${add(params, filters.executiveId)}`);
  if (filters.source) where.push(`l.source = ${add(params, filters.source)}`);
  if (filters.status) where.push(`l.status = ${add(params, filters.status)}`);
  if (filters.projectId) where.push(`p.project_id = ${add(params, filters.projectId)}`);
  if (filters.propertyId) where.push(`l.property_id = ${add(params, filters.propertyId)}`);
  if (filters.transactionType) where.push(`p.transaction_type = ${add(params, filters.transactionType)}`);
  if (filters.propertyCategory) where.push(`p.property_type = ${add(params, filters.propertyCategory)}`);
  if (filters.location) where.push(`p.location ILIKE ${add(params, `%${filters.location}%`)}`);
  if (filters.priceBand) where.push(`${priceBandSql('l.budget')} = ${add(params, filters.priceBand)}`);
  if (filters.minPrice !== undefined) where.push(`l.budget >= ${add(params, filters.minPrice)}`);
  if (filters.maxPrice !== undefined) where.push(`l.budget <= ${add(params, filters.maxPrice)}`);
  return where;
}

const from = `FROM leads l
  JOIN properties p ON p.id = l.property_id
  LEFT JOIN projects pr ON pr.id = p.project_id
  LEFT JOIN users e ON e.id = l.assigned_executive_id
  LEFT JOIN users m ON m.id = e.manager_id`;

export async function listLeadReportRows(filters: ReportFilters, scopeInfo: ReportScope, all = false): Promise<LeadReportRow[]> {
  const params: ParamList = [];
  const where = predicates(filters, scopeInfo, params);
  const limit = add(params, all ? Math.min(filters.limit, 10_000) : filters.limit);
  const offset = add(params, all ? 0 : filters.offset);
  const result = await pool.query<LeadReportRow>(
    `SELECT l.lead_no AS "leadNo", l.id AS "leadId", l.created_at AS "createdAt", l.status, l.source,
       l.assigned_executive_id AS "assignedExecutiveId", e.name AS "assignedExecutiveName",
       e.manager_id AS "managerId", m.name AS "managerName", pr.id AS "projectId", pr.project_code AS "projectCode", pr.name AS "projectName",
       p.id AS "propertyId", p.name AS "propertyName", p.transaction_type AS "transactionType", p.property_type AS "propertyCategory",
       p.location, ${priceBandSql('l.budget')} AS "priceBand", l.follow_up_at AS "followUpAt"
     ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY l.created_at DESC, l.id LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return result.rows;
}

export async function summary(filters: ReportFilters, scopeInfo: ReportScope) {
  const params: ParamList = [];
  const where = predicates(filters, scopeInfo, params);
  const newLeadsExpression = filters.fromDate || filters.toDate ? 'count(*)' : `count(*) FILTER (WHERE l.created_at >= now() - interval '1 day')`;
  const result = await pool.query<{ total: string; assigned: string; new_leads: string }>(
    `SELECT count(*)::text AS total, count(*) FILTER (WHERE l.assigned_executive_id IS NOT NULL)::text AS assigned,
       ${newLeadsExpression}::text AS new_leads
     ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  const row = result.rows[0];
  return { total: Number(row.total), assigned: Number(row.assigned), unassigned: Number(row.total) - Number(row.assigned), newLeads: Number(row.new_leads) };
}

const dimensions: Record<string, { expression: string; key: string; label: string }> = {
  status: { expression: 'l.status', key: 'status', label: 'status' },
  source: { expression: 'l.source', key: 'source', label: 'source' },
  executive: { expression: 'e.id', key: 'executiveId', label: 'executiveName' },
  manager: { expression: 'm.id', key: 'managerId', label: 'managerName' },
  project: { expression: 'pr.id', key: 'projectId', label: 'projectName' },
  property: { expression: 'p.id', key: 'propertyId', label: 'propertyName' },
  transactionType: { expression: 'p.transaction_type', key: 'transactionType', label: 'transactionType' },
  propertyCategory: { expression: 'p.property_type', key: 'propertyCategory', label: 'propertyCategory' },
  location: { expression: `COALESCE(NULLIF(btrim(p.location), ''), 'UNSPECIFIED')`, key: 'location', label: 'location' },
  priceBand: { expression: priceBandSql('l.budget'), key: 'priceBand', label: 'priceBand' },
};

export async function breakdown(filters: ReportFilters, scopeInfo: ReportScope, dimension: keyof typeof dimensions): Promise<BreakdownRow[]> {
  const d = dimensions[dimension];
  const params: ParamList = [];
  const where = predicates(filters, scopeInfo, params);
  const result = await pool.query<{ key: string | null; label: string | null; count: string }>(
    `SELECT ${d.expression} AS key, ${d.expression === 'e.id' ? 'e.name' : d.expression === 'm.id' ? 'm.name' : d.expression === 'pr.id' ? 'pr.name' : d.expression === 'p.id' ? 'p.name' : d.expression} AS label, count(DISTINCT l.id)::text AS count
     ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY ${d.expression}, label ORDER BY count DESC, label NULLS LAST`,
    params,
  );
  return result.rows.map((row) => ({ key: row.key, label: row.label ?? 'UNSPECIFIED', count: Number(row.count) }));
}

export async function executiveMetrics(filters: ReportFilters, scopeInfo: ReportScope) {
  const params: ParamList = [];
  const currentWhere = predicates(filters, scopeInfo, params);
  const current = await pool.query<{ id: string | null; name: string | null; manager_id: string | null; current_leads: string; pending_follow_ups: string }>(
    `SELECT e.id, e.name, e.manager_id, count(DISTINCT l.id)::text AS current_leads,
       count(DISTINCT l.id) FILTER (WHERE l.follow_up_at IS NOT NULL AND l.follow_up_at >= now())::text AS pending_follow_ups
     ${from} ${currentWhere.length ? `WHERE ${currentWhere.join(' AND ')} AND e.id IS NOT NULL` : 'WHERE e.id IS NOT NULL'}
     GROUP BY e.id, e.name, e.manager_id ORDER BY current_leads DESC, e.name`,
    params,
  );
  const historyParams: ParamList = [];
  const historicalWhere = predicates(filters, scopeInfo, historyParams, 'h.created_at').map((clause) => clause.replaceAll('l.assigned_executive_id', 'h.executive_id'));
  const history = await pool.query<{ id: string; assigned_during_period: string; reassignments: string }>(
    `SELECT h.executive_id AS id, count(*)::text AS assigned_during_period,
       count(*) FILTER (WHERE h.method IN ('TRANSFER', 'TIMEOUT'))::text AS reassignments
     FROM property_assignment_history h JOIN leads l ON l.id = h.lead_id JOIN properties p ON p.id = l.property_id
     LEFT JOIN projects pr ON pr.id = p.project_id LEFT JOIN users e ON e.id = h.executive_id LEFT JOIN users m ON m.id = e.manager_id
     ${historicalWhere.length ? `WHERE ${historicalWhere.join(' AND ')}` : ''}
     GROUP BY h.executive_id`,
    historyParams,
  );
  const byId = new Map(history.rows.map((row) => [row.id, row]));
  return current.rows.map((row) => ({
    executiveId: row.id,
    executiveName: row.name,
    managerId: row.manager_id,
    currentLeads: Number(row.current_leads),
    assignedDuringPeriod: Number(byId.get(row.id!)?.assigned_during_period ?? 0),
    reassignmentCount: Number(byId.get(row.id!)?.reassignments ?? 0),
    pendingFollowUps: Number(row.pending_follow_ups),
  }));
}

export async function managerMetrics(filters: ReportFilters, scopeInfo: ReportScope) {
  const rows = await breakdown(filters, scopeInfo, 'manager');
  const params: ParamList = [];
  const result = await pool.query<{ manager_id: string; active_executives: string }>(
    `SELECT e.manager_id, count(DISTINCT e.id)::text AS active_executives FROM users e WHERE e.role = 'SALES' AND e.is_active AND e.deleted_at IS NULL AND e.manager_id IS NOT NULL
     ${scopeInfo.role === 'MANAGER' ? `AND e.manager_id = ${add(params, scopeInfo.managerId)}` : filters.managerId ? `AND e.manager_id = ${add(params, filters.managerId)}` : ''}
     GROUP BY e.manager_id`, params,
  );
  const active = new Map(result.rows.map((r) => [r.manager_id, Number(r.active_executives)]));
  return rows.map((row) => ({ managerId: row.key, managerName: row.label, currentLeads: row.count, activeExecutives: active.get(row.key ?? '') ?? 0 }));
}

export async function followUpMetrics(filters: ReportFilters, scopeInfo: ReportScope) {
  const params: ParamList = [];
  const where = predicates(filters, scopeInfo, params);
  const result = await pool.query<{ due: string; overdue: string; pending: string }>(
    `SELECT count(*) FILTER (WHERE l.follow_up_at IS NOT NULL AND l.follow_up_at <= now())::text AS overdue,
       count(*) FILTER (WHERE l.follow_up_at IS NOT NULL AND l.follow_up_at > now())::text AS pending,
       count(*) FILTER (WHERE l.follow_up_at IS NOT NULL)::text AS due ${from} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  const row = result.rows[0];
  return { due: Number(row.due), overdue: Number(row.overdue), pending: Number(row.pending), completed: null, completedAvailable: false };
}

export async function propertyMetrics(filters: ReportFilters, scopeInfo: ReportScope) {
  const params: ParamList = [];
  const propertyWhere: string[] = [];
  const leadFilters = [...scope(scopeInfo, params), ...dateRange(filters, params)];

  // Property dimensions identify the master record. Lead dimensions are deliberately put
  // in the LEFT JOIN so a visible property with zero matching leads is still reported as 0.
  if (filters.propertyId) propertyWhere.push(`p.id = ${add(params, filters.propertyId)}`);
  if (filters.projectId) propertyWhere.push(`p.project_id = ${add(params, filters.projectId)}`);
  if (filters.transactionType) propertyWhere.push(`p.transaction_type = ${add(params, filters.transactionType)}`);
  if (filters.propertyCategory) propertyWhere.push(`p.property_type = ${add(params, filters.propertyCategory)}`);
  if (filters.location) propertyWhere.push(`p.location ILIKE ${add(params, `%${filters.location}%`)}`);
  if (filters.managerId && scopeInfo.role === 'ADMIN') leadFilters.push(`e.manager_id = ${add(params, filters.managerId)}`);
  if (filters.executiveId && scopeInfo.role !== 'SALES') leadFilters.push(`l.assigned_executive_id = ${add(params, filters.executiveId)}`);
  if (filters.source) leadFilters.push(`l.source = ${add(params, filters.source)}`);
  if (filters.status) leadFilters.push(`l.status = ${add(params, filters.status)}`);
  if (filters.priceBand) leadFilters.push(`${priceBandSql('l.budget')} = ${add(params, filters.priceBand)}`);
  if (filters.minPrice !== undefined) leadFilters.push(`l.budget >= ${add(params, filters.minPrice)}`);
  if (filters.maxPrice !== undefined) leadFilters.push(`l.budget <= ${add(params, filters.maxPrice)}`);

  // A scoped user may only see properties that have at least one lead in their scope.
  // Admins can see master properties even before the first enquiry arrives.
  if (scopeInfo.role === 'SALES') propertyWhere.push(`EXISTS (SELECT 1 FROM leads visible_l WHERE visible_l.property_id = p.id AND visible_l.assigned_executive_id = ${add(params, scopeInfo.executiveId)})`);
  if (scopeInfo.role === 'MANAGER') {
    const manager = add(params, scopeInfo.managerId);
    propertyWhere.push(`EXISTS (SELECT 1 FROM leads visible_l LEFT JOIN users visible_e ON visible_e.id = visible_l.assigned_executive_id
      WHERE visible_l.property_id = p.id AND (visible_e.manager_id = ${manager} OR (visible_l.assigned_executive_id IS NULL AND (visible_l.property_review_manager_id IS NULL OR visible_l.property_review_manager_id = ${manager}))))`);
  }
  const result = await pool.query<{ property_id: string; property_name: string; project_id: string | null; project_name: string | null; leads: string; inventory: string; available_inventory: string }>(
    `SELECT p.id AS property_id, p.name AS property_name, pr.id AS project_id, pr.name AS project_name,
       count(DISTINCT l.id)${leadFilters.length ? ` FILTER (WHERE ${leadFilters.join(' AND ')})` : ''}::text AS leads,
       (SELECT count(*) FROM inventory i WHERE i.property_id = p.id)::text AS inventory,
       (SELECT count(*) FROM inventory i WHERE i.property_id = p.id AND i.status = 'AVAILABLE')::text AS available_inventory
     FROM properties p
     LEFT JOIN projects pr ON pr.id = p.project_id
     LEFT JOIN leads l ON l.property_id = p.id
     LEFT JOIN users e ON e.id = l.assigned_executive_id
     LEFT JOIN users m ON m.id = e.manager_id
     ${propertyWhere.length ? `WHERE ${propertyWhere.join(' AND ')}` : ''}
     GROUP BY p.id, p.name, pr.id, pr.name ORDER BY leads DESC, p.name`,
    params,
  );
  return result.rows.map((row) => ({
    propertyId: row.property_id,
    propertyName: row.property_name,
    projectId: row.project_id,
    projectName: row.project_name,
    leads: Number(row.leads),
    inventoryCount: Number(row.inventory),
    availableInventoryCount: Number(row.available_inventory),
  }));
}
