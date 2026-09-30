import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './executive.controller';
import {
  assignTeamSchema,
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
executiveRouter.patch('/:executiveId/team', validateBody(assignTeamSchema), c.assignTeam);
executiveRouter.delete('/:executiveId/team', c.removeFromTeam);
