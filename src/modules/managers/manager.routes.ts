import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { managerController as c } from '../executives/executive.controller';
import { createManagerSchema, passwordSchema, statusSchema, updateManagerSchema } from '../executives/executive.validation';

/**
 * Admin-only management of manager accounts. Same behaviour as /admin/executives (they share one service),
 * minus team membership: a manager leads teams, set through the team's `managerId`.
 */
export const managerRouter = Router();

managerRouter.get('/', c.list);
managerRouter.post('/', validateBody(createManagerSchema), c.create);
managerRouter.get('/:id', c.get);
managerRouter.patch('/:id', validateBody(updateManagerSchema), c.update);
managerRouter.delete('/:id', c.remove);
managerRouter.patch('/:id/password', validateBody(passwordSchema), c.changePassword);
managerRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
