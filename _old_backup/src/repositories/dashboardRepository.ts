import { Db, queryOne } from '../db/pool';
import { LeadFilters, buildLeadWhere } from './leadFilters';

export interface DashboardSummary {
  totalLeads: number; assigned: number; pending: number; overdue: number; connected: number;
  followUp: number; lost: number; closed: number; invalid: number; unassigned: number; reassigned: number;
}

export const dashboardRepository = {
  async summary(db: Db, f: LeadFilters): Promise<DashboardSummary> {
    const params: unknown[] = [];
    const where = buildLeadWhere(f, params);
    return (await queryOne<DashboardSummary>(db,
      `SELECT
         count(*)                                                          AS total_leads,
         count(*) FILTER (WHERE l.assigned_to IS NOT NULL)                 AS assigned,
         count(*) FILTER (WHERE l.status IN ('NEW','ASSIGNED'))            AS pending,
         count(*) FILTER (WHERE l.status = 'ASSIGNED' AND l.contacted_at IS NULL AND l.sla_deadline < now()) AS overdue,
         count(*) FILTER (WHERE l.contacted_at IS NOT NULL)                AS connected,
         count(*) FILTER (WHERE l.status = 'FOLLOW_UP')                    AS follow_up,
         count(*) FILTER (WHERE l.status = 'LOST')                         AS lost,
         count(*) FILTER (WHERE l.status = 'CLOSED')                       AS closed,
         count(*) FILTER (WHERE l.status = 'INVALID')                      AS invalid,
         count(*) FILTER (WHERE l.status = 'NEW')                          AS unassigned,
         count(*) FILTER (WHERE l.reassign_count > 0)                      AS reassigned
       FROM leads l JOIN projects p ON p.id = l.project_id WHERE ${where}`, params))!;
  },
};
