import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './team.controller';
import { createTeamSchema, statusSchema, updateTeamSchema } from './team.validation';

export const teamRouter = Router();

teamRouter.get('/', c.list);
teamRouter.post('/', validateBody(createTeamSchema), c.create);
teamRouter.get('/:teamId/executives', c.listExecutives);
teamRouter.get('/:id', c.get);
teamRouter.patch('/:id', validateBody(updateTeamSchema), c.update);
teamRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
