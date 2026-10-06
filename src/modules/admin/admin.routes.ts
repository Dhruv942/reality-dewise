import { Router } from 'express';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { customerRouter } from '../customers/customer.routes';
import { executiveRouter } from '../executives/executive.routes';
import { managerRouter } from '../managers/manager.routes';
import { adminLeadRouter } from '../leads/lead.routes';
import { propertyRouter } from '../properties/property.routes';
import { settingsRouter } from '../settings/settings.routes';
import { teamRouter } from '../teams/team.routes';

/** Everything under /api/v1/admin requires an authenticated ADMIN. Future admin modules mount here. */
export const adminRouter = Router();

adminRouter.use(authenticate(), authorizeRoles('ADMIN'));
adminRouter.use('/executives', executiveRouter);
adminRouter.use('/managers', managerRouter);
adminRouter.use('/teams', teamRouter);
adminRouter.use('/properties', propertyRouter);
adminRouter.use('/customers', customerRouter);
adminRouter.use('/leads', adminLeadRouter);
adminRouter.use('/settings', settingsRouter);
