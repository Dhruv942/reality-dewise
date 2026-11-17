import type { Request, Response } from 'express';
import { Router } from 'express';
import { NotFoundError, UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { executiveService } from '../executives/executive.service';
import { idParam, listExecutivesQuery } from '../executives/executive.validation';
import { managerLeadRouter } from '../leads/lead.routes';
import { managerPropertyRouter } from '../properties/property.routes';
import { reportRouter } from '../reports/report.routes';

/** Everything under /api/v1/manager requires an authenticated MANAGER. */
export const managerPortalRouter = Router();

managerPortalRouter.use(authenticate(), authorizeRoles('MANAGER'));

const me = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

/** The sales executives / executive managers that report to this manager: who leads and properties can be given to. */
managerPortalRouter.get('/executives', async (req: Request, res: Response) => {
  res.json(await executiveService.list({ ...parse(listExecutivesQuery, req.query), managerId: me(req) }));
});
/** One of those executives (anyone else's looks like "not found"). */
managerPortalRouter.get('/executives/:id', async (req: Request, res: Response) => {
  const dto = await executiveService.details(parse(idParam, req.params).id);
  if (dto.manager?.id !== me(req)) throw new NotFoundError('Executive not found');
  res.json(dto);
});
managerPortalRouter.use('/leads', managerLeadRouter);
managerPortalRouter.use('/properties', managerPropertyRouter);
managerPortalRouter.use('/reports', reportRouter);
