/** Shared WHERE builder for the leads list and the dashboard. Queries must alias leads as `l` and projects as `p`. */
export interface LeadFilters {
  projectId?: number; teamId?: number; assignedTo?: number; source?: string;
  status?: string; customerId?: number; from?: Date; to?: Date;
}

export function buildLeadWhere(f: LeadFilters, params: unknown[]): string {
  const conds = ['l.deleted_at IS NULL'];
  const add = (sql: string, value: unknown) => { params.push(value); conds.push(sql.replace('?', `$${params.length}`)); };
  if (f.projectId !== undefined) add('l.project_id = ?', f.projectId);
  if (f.teamId !== undefined) add('p.team_id = ?', f.teamId);
  if (f.assignedTo !== undefined) add('l.assigned_to = ?', f.assignedTo);
  if (f.source !== undefined) add('l.source = ?', f.source);
  if (f.status !== undefined) add('l.status = ?::lead_status', f.status);
  if (f.customerId !== undefined) add('l.customer_id = ?', f.customerId);
  if (f.from !== undefined) add('l.created_at >= ?', f.from);
  if (f.to !== undefined) add('l.created_at <= ?', f.to);
  return conds.join(' AND ');
}
