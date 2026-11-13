import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { executiveController as c } from './executive.controller';
import {
  assignManagerSchema,
  createExecutiveSchema,
  passwordSchema,
  statusSchema,
  updateExecutiveSchema,
} from './executive.validation';

export const executiveRouter = Router();

executiveRouter.get('/', c.list);
executiveRouter.post('/', validateBody(createExecutiveSchema), c.create);
executiveRouter.get('/:id', c.get);
executiveRouter.patch('/:id', validateBody(updateExecutiveSchema), c.update);
executiveRouter.delete('/:id', c.remove);
executiveRouter.patch('/:id/password', validateBody(passwordSchema), c.changePassword);
executiveRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
executiveRouter.patch('/:executiveId/manager', validateBody(assignManagerSchema), c.assignManager);
executiveRouter.delete('/:executiveId/manager', c.removeManager);
