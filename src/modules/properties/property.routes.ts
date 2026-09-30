import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './property.controller';
import {
  changeTeamSchema,
  createPropertySchema,
  setExecutiveSchema,
  statusSchema,
  updatePropertySchema,
} from './property.validation';

export const propertyRouter = Router();

propertyRouter.get('/', c.list);
propertyRouter.post('/', validateBody(createPropertySchema), c.create);
propertyRouter.get('/:id', c.get);
propertyRouter.patch('/:id', validateBody(updatePropertySchema), c.update);
propertyRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
propertyRouter.patch('/:id/team', validateBody(changeTeamSchema), c.changeTeam);
propertyRouter.patch('/:id/executive', validateBody(setExecutiveSchema), c.setExecutive);
propertyRouter.delete('/:id/executive', c.removeExecutive);
propertyRouter.get('/:id/assignment-history', c.history);
