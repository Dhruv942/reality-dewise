import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { managerController as c } from '../executives/executive.controller';
import { createManagerSchema, passwordSchema, statusSchema, updateManagerSchema } from '../executives/executive.validation';

/**
 * Admin-only management of manager accounts. Same behaviour as /admin/executives (they share one service),
 * minus a manager of their own: a manager looks after the sales users whose `managerId` points at them
 * (set on the executive: POST/PATCH /admin/executives or PATCH /admin/executives/:id/manager).
 */
export const managerRouter = Router();

managerRouter.get('/', c.list);
managerRouter.post('/', validateBody(createManagerSchema), c.create);
managerRouter.get('/:id', c.get);
managerRouter.patch('/:id', validateBody(updateManagerSchema), c.update);
managerRouter.delete('/:id', c.remove);
managerRouter.patch('/:id/password', validateBody(passwordSchema), c.changePassword);
managerRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
