import { Router } from 'express';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { executiveLeadRouter } from '../leads/lead.routes';

/** Everything under /api/v1/executive requires an authenticated SALES user (sales executive or executive manager). */
export const portalRouter = Router();

portalRouter.use(authenticate(), authorizeRoles('SALES'));
portalRouter.use('/leads', executiveLeadRouter);
