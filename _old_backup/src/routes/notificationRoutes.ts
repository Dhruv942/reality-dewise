import { Router } from 'express';
import { handleListNotifications, handleMarkNotificationRead } from '../controllers/notificationController';

export const notificationRouter = Router();

notificationRouter.get('/', handleListNotifications);
notificationRouter.patch('/:id/read', handleMarkNotificationRead);
