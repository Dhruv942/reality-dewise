import { Request, Response } from 'express';
import { notificationService } from '../services/crudServices';
import { listNotificationsQuerySchema } from '../validators';

export async function handleListNotifications(req: Request, res: Response) {
  const query = listNotificationsQuerySchema.parse(req.query);
  const unread = query.status === 'PENDING' ? true : undefined;
  const result = await notificationService.list({ userId: query.userId, unread }, { page: query.page, limit: query.limit });
  res.json(result);
}

export async function handleMarkNotificationRead(req: Request, res: Response) {
  const id = Number(req.params.id);
  const notification = await notificationService.markRead(id);
  res.json(notification);
}
