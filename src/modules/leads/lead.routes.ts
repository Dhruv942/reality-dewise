import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './lead.controller';
import { assignLeadSchema, createLeadSchema, statusSchema } from './lead.validation';

export const adminLeadRouter = Router();
adminLeadRouter.get('/', c.adminList);
adminLeadRouter.post('/', validateBody(createLeadSchema), c.adminCreate);
adminLeadRouter.get('/:id', c.adminGet);
adminLeadRouter.patch('/:id/status', validateBody(statusSchema), c.adminSetStatus);
adminLeadRouter.patch('/:id/assign', validateBody(assignLeadSchema), c.assign);
adminLeadRouter.post('/:id/important', c.markImportant);
adminLeadRouter.delete('/:id/important', c.unmarkImportant);

/** A manager works with their teams' leads and unassigned ones, and assigns them to executives of their teams. */
export const managerLeadRouter = Router();
managerLeadRouter.get('/', c.managerList);
managerLeadRouter.get('/:id', c.managerGet);
managerLeadRouter.patch('/:id/assign', validateBody(assignLeadSchema), c.assign);
managerLeadRouter.post('/:id/important', c.markImportant);
managerLeadRouter.delete('/:id/important', c.unmarkImportant);

export const executiveLeadRouter = Router();
executiveLeadRouter.get('/', c.myList);
executiveLeadRouter.get('/summary', c.mySummary); // before /:id
executiveLeadRouter.get('/:id', c.myGet);
executiveLeadRouter.patch('/:id/status', validateBody(statusSchema), c.mySetStatus);
executiveLeadRouter.post('/:id/important', c.markImportant);
executiveLeadRouter.delete('/:id/important', c.unmarkImportant);
