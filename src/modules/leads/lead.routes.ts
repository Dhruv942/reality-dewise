import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './lead.controller';
import { assignLeadSchema, commentSchema, createLeadSchema, followUpSchema, managerCreateLeadSchema, registerPropertyMappingSchema, resolvePropertySchema, statusSchema, transferLeadSchema } from './lead.validation';

export const adminLeadRouter = Router();
adminLeadRouter.get('/', c.adminList);
adminLeadRouter.post('/', validateBody(createLeadSchema), c.adminCreate);
adminLeadRouter.get('/unmatched-properties', c.adminUnmatchedProperties);
adminLeadRouter.get('/:id/property-match-candidates', c.propertyMatchCandidates);
adminLeadRouter.post('/:id/resolve-property', validateBody(resolvePropertySchema), c.resolveProperty);
adminLeadRouter.post('/:id/register-property-mapping', validateBody(registerPropertyMappingSchema), c.registerPropertyMapping);
adminLeadRouter.get('/:id', c.adminGet);
adminLeadRouter.post('/:id/comments', validateBody(commentSchema), c.addComment);
adminLeadRouter.patch('/:id/status', validateBody(statusSchema), c.adminSetStatus);
adminLeadRouter.patch('/:id/assign', validateBody(assignLeadSchema), c.assign);
adminLeadRouter.post('/:id/transfer', validateBody(transferLeadSchema), c.transfer);
adminLeadRouter.post('/:id/important', c.markImportant);
adminLeadRouter.delete('/:id/important', c.unmarkImportant);
adminLeadRouter.put('/:id/follow-up', validateBody(followUpSchema), c.setFollowUp);
adminLeadRouter.delete('/:id/follow-up', c.clearFollowUp);

/** A manager works with their executives' leads and unassigned ones, and assigns them to their own executives. */
export const managerLeadRouter = Router();
managerLeadRouter.get('/', c.managerList);
managerLeadRouter.post('/', validateBody(managerCreateLeadSchema), c.managerCreate);
managerLeadRouter.get('/:id', c.managerGet);
managerLeadRouter.post('/:id/comments', validateBody(commentSchema), c.addComment);
managerLeadRouter.patch('/:id/assign', validateBody(assignLeadSchema), c.assign);
managerLeadRouter.post('/:id/transfer', validateBody(transferLeadSchema), c.transfer);
managerLeadRouter.post('/:id/important', c.markImportant);
managerLeadRouter.delete('/:id/important', c.unmarkImportant);
managerLeadRouter.put('/:id/follow-up', validateBody(followUpSchema), c.setFollowUp);
managerLeadRouter.delete('/:id/follow-up', c.clearFollowUp);

export const executiveLeadRouter = Router();
executiveLeadRouter.get('/', c.myList);
executiveLeadRouter.get('/summary', c.mySummary); // before /:id
executiveLeadRouter.get('/:id', c.myGet);
executiveLeadRouter.post('/:id/comments', validateBody(commentSchema), c.addComment);
executiveLeadRouter.patch('/:id/status', validateBody(statusSchema), c.mySetStatus);
executiveLeadRouter.post('/:id/important', c.markImportant);
executiveLeadRouter.delete('/:id/important', c.unmarkImportant);
executiveLeadRouter.put('/:id/follow-up', validateBody(followUpSchema), c.setFollowUp);
executiveLeadRouter.delete('/:id/follow-up', c.clearFollowUp);
