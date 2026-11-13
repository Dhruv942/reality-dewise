import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import * as service from './view.service';

/**
 * Read-only dashboards of other users. ADMIN may view any manager or executive; MANAGER only their own
 * executives. GET only: acting on a lead or property still uses the caller's own portal endpoints and checks.
 */
export const viewRouter = Router();

viewRouter.use(authenticate(), authorizeRoles('ADMIN', 'MANAGER'));

const viewer = (req: Request): service.Viewer => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER')) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role };
};
const idParam = z.object({ id: z.uuid('Invalid id') });
const executivesQuery = z.object({ managerId: z.uuid('Invalid manager id').optional() });

/** The sales users the caller may switch to. */
viewRouter.get('/executives', async (req: Request, res: Response) => {
  res.json(await service.listViewableExecutives(viewer(req), parse(executivesQuery, req.query).managerId));
});
viewRouter.get('/executives/:id/dashboard', async (req: Request, res: Response) => {
  res.json(await service.executiveDashboard(viewer(req), parse(idParam, req.params).id));
});

/** Admin only: managers to switch to, and what their dashboard shows. */
viewRouter.get('/managers', authorizeRoles('ADMIN'), async (_req: Request, res: Response) => {
  res.json(await service.listViewableManagers());
});
viewRouter.get('/managers/:id/dashboard', authorizeRoles('ADMIN'), async (req: Request, res: Response) => {
  res.json(await service.managerDashboard(parse(idParam, req.params).id, viewer(req).id));
});
