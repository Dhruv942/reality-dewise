import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './project.controller';
import { createProjectSchema, updateProjectSchema } from './project.validation';

export const projectRouter = Router();
projectRouter.get('/', c.list);
projectRouter.post('/', validateBody(createProjectSchema), c.create);
projectRouter.get('/:id', c.get);
projectRouter.patch('/:id', validateBody(updateProjectSchema), c.update);
projectRouter.post('/:id/archive', c.archive);
