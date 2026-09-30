import { Router } from 'express';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { executiveLeadRouter } from '../leads/lead.routes';

/** Everything under /api/v1/executive requires an authenticated EXECUTIVE. */
export const portalRouter = Router();

portalRouter.use(authenticate(), authorizeRoles('EXECUTIVE'));
portalRouter.use('/leads', executiveLeadRouter);
