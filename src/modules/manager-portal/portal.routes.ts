import type { Request, Response } from 'express';
import { Router } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { executiveService } from '../executives/executive.service';
import { managerLeadRouter } from '../leads/lead.routes';
import { listTeams } from '../teams/team.service';

/** Everything under /api/v1/manager requires an authenticated MANAGER. */
export const managerPortalRouter = Router();

managerPortalRouter.use(authenticate(), authorizeRoles('MANAGER'));

const me = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

/** The teams this manager leads. */
managerPortalRouter.get('/teams', async (req: Request, res: Response) => {
  res.json(await listTeams({ managerId: me(req) }));
});
/** The sales executives / executive managers in those teams: who leads can be assigned to. */
managerPortalRouter.get('/executives', async (req: Request, res: Response) => {
  res.json(await executiveService.list({ managerId: me(req) }));
});
managerPortalRouter.use('/leads', managerLeadRouter);
