import { Router } from 'express';
import { authenticate, authorizeRoles } from '../auth/auth.middleware';
import * as c from './zoho.controller';
import { validateBody } from '../../middleware/validate';
import { testEmailSchema } from './zoho.validation';

export const zohoIntegrationRouter = Router();
zohoIntegrationRouter.use(authenticate(), authorizeRoles('ADMIN'));
zohoIntegrationRouter.get('/status', c.status);
zohoIntegrationRouter.post('/disconnect', c.disconnect);
zohoIntegrationRouter.post('/test-email', validateBody(testEmailSchema), c.testEmail);
zohoIntegrationRouter.patch('/notifications', c.updateNotificationSetting);
zohoIntegrationRouter.post('/notifications/:id/retry', c.retryNotification);
