import { Router } from 'express';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import { customerRouter } from '../customers/customer.routes';
import { executiveRouter } from '../executives/executive.routes';
import { managerRouter } from '../managers/manager.routes';
import { adminLeadRouter } from '../leads/lead.routes';
import { propertyRouter } from '../properties/property.routes';
import { projectRouter } from '../projects/project.routes';
import { inventoryRouter } from '../inventory/inventory.routes';
import { propertyMappingRouter } from '../property-mappings/property-mapping.routes';
import { settingsRouter } from '../settings/settings.routes';
import { reportRouter } from '../reports/report.routes';

/** Everything under /api/v1/admin requires an authenticated ADMIN. Future admin modules mount here. */
export const adminRouter = Router();

adminRouter.use(authenticate(), authorizeRoles('ADMIN'));
adminRouter.use('/executives', executiveRouter);
adminRouter.use('/managers', managerRouter);
adminRouter.use('/properties', propertyRouter);
adminRouter.use('/projects', projectRouter);
adminRouter.use('/inventory', inventoryRouter);
adminRouter.use('/property-mappings', propertyMappingRouter);
adminRouter.use('/customers', customerRouter);
adminRouter.use('/leads', adminLeadRouter);
adminRouter.use('/settings', settingsRouter);
adminRouter.use('/reports', reportRouter);
