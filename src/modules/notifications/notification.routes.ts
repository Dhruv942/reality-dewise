import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import * as c from './notification.controller';

/** /api/v1/notifications: any logged-in user, always and only their own notifications. */
export const notificationRouter = Router();

notificationRouter.use(authenticate());
notificationRouter.get('/', c.list);
notificationRouter.patch('/read-all', c.markAllRead); // before /:id
notificationRouter.patch('/:id/read', c.markRead);
