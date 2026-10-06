import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './settings.controller';
import { updateAssignmentRuleSchema, updateLeadTimeoutSchema } from './settings.validation';

/** Mounted under /api/v1/admin, so every route here is ADMIN-only (managers and sales users get 403). */
export const settingsRouter = Router();

settingsRouter.get('/assignment-rule', c.getAssignmentRule);
settingsRouter.put('/assignment-rule', validateBody(updateAssignmentRuleSchema), c.updateAssignmentRule);
settingsRouter.get('/lead-timeout', c.getLeadTimeout);
settingsRouter.put('/lead-timeout', validateBody(updateLeadTimeoutSchema), c.updateLeadTimeout);
