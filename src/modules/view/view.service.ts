import { NotFoundError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';
import { toExecutiveDto } from '../executives/executive.model';
import * as leadRepo from '../leads/lead.repository';
import { executiveSummary, listLeads } from '../leads/lead.service';

/**
 * Read-only "view as" dashboards. The caller keeps their own identity and role: this only decides which other
 * user's data they may LOOK at, and nothing here changes anything. Every action (assign, status, follow-up ...)
 * still goes through the caller's own admin / manager endpoints and their own checks.
 *
 *   ADMIN   : any live manager, any live sales user.
 *   MANAGER : only sales users whose users.manager_id is them (anyone else looks like "not found").
 */
export type Viewer = { id: string; role: 'ADMIN' | 'MANAGER' };

const RECENT = 8;

/** The sales users this viewer may look at (admin: all, or one manager's; manager: their own). */
export async function listViewableExecutives(viewer: Viewer, managerId?: string) {
  const scope = viewer.role === 'MANAGER' ? viewer.id : managerId;
  return (await executiveRepo.list({ role: 'SALES', managerId: scope })).map(toExecutiveDto);
}

export async function listViewableManagers() {
  return (await executiveRepo.list({ role: 'MANAGER' })).map(toExecutiveDto);
}

async function viewableExecutive(viewer: Viewer, id: string) {
  const row = await executiveRepo.findById(id).catch((err) => {
    if ((err as { code?: string }).code === '22P02') return null;
    throw err;
  });
  if (!row || row.deleted_at || row.role !== 'SALES') throw new NotFoundError('Executive not found');
  if (viewer.role === 'MANAGER' && row.manager_id !== viewer.id) throw new NotFoundError('Executive not found');
  return row;
}

/** What that executive's own dashboard shows. The viewer is not that executive: "new" flags are not cleared. */
export async function executiveDashboard(viewer: Viewer, executiveId: string) {
  const row = await viewableExecutive(viewer, executiveId);
  return {
    readOnly: true,
    viewing: { role: 'SALES' as const, user: toExecutiveDto(row) },
    summary: await executiveSummary(executiveId),
    recentLeads: await listLeads({ executiveId, forExecutive: true, viewerId: viewer.id, limit: RECENT, offset: 0 }),
  };
}

/** What that manager's own dashboard shows (admin only): their executives and their lead scope. */
export async function managerDashboard(managerId: string, viewerId: string) {
  const row = await executiveRepo.findById(managerId).catch((err) => {
    if ((err as { code?: string }).code === '22P02') return null;
    throw err;
  });
  if (!row || row.deleted_at || row.role !== 'MANAGER') throw new NotFoundError('Manager not found');
  const byStatus = await leadRepo.summaryForManager(managerId);
  return {
    readOnly: true,
    viewing: { role: 'MANAGER' as const, user: toExecutiveDto(row) },
    executives: (await executiveRepo.list({ role: 'SALES', managerId })).map(toExecutiveDto),
    summary: {
      totalLeads: byStatus.reduce((n, r) => n + r.total, 0),
      pendingLeads: byStatus.find((r) => r.status === 'PENDING_ASSIGNMENT')?.total ?? 0,
      byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.total])),
    },
    recentLeads: await listLeads({ managerId, viewerId, limit: RECENT, offset: 0 }),
  };
}
