import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './lead.controller';
import { createLeadSchema, statusSchema } from './lead.validation';

export const adminLeadRouter = Router();
adminLeadRouter.get('/', c.adminList);
adminLeadRouter.post('/', validateBody(createLeadSchema), c.adminCreate);
adminLeadRouter.get('/:id', c.adminGet);
adminLeadRouter.patch('/:id/status', validateBody(statusSchema), c.adminSetStatus);

export const executiveLeadRouter = Router();
executiveLeadRouter.get('/', c.myList);
executiveLeadRouter.get('/:id', c.myGet);
executiveLeadRouter.patch('/:id/status', validateBody(statusSchema), c.mySetStatus);
