import { NotFoundError } from '../../utils/errors';
import { emitTo, rooms } from '../../realtime/socket';
import { pushNotification } from '../push/push.service';
import * as repo from './notification.repository';
import { toNotificationDto } from './notification.model';

/**
 * Stores a notification and only then pushes it live (notification:new). The row is what counts: a user who
 * misses the socket event reads it over REST. A repeated event (same dedupeKey) stores and emits nothing.
 * Call this after the business change has committed. Returns whether a new notification was created.
 */
export async function notify(n: repo.NewNotification): Promise<boolean> {
  const row = await repo.insertOnce(n);
  if (!row) {
    console.log(`Notification skipped (duplicate): ${n.type} for user ${n.userId} (${n.entityType} ${n.entityId})`);
    return false;
  }
  console.log(`Notification created: ${n.type} id=${row.id} for user ${n.userId} (${n.entityType} ${n.entityId})`);
  emitTo('notification:new', [rooms.user(n.userId)], toNotificationDto(row), `id=${row.id} type=${n.type}`);
  pushNotification(row); // closed-app delivery (Web Push); does not block or fail the caller
  return true;
}

export const listMine = async (userId: string, f: { unreadOnly?: boolean; limit: number; offset: number }) => ({
  unreadCount: await repo.unreadCount(userId),
  notifications: (await repo.listForUser(userId, f)).map(toNotificationDto),
});

export async function markRead(userId: string, id: string) {
  const row = await repo.markRead(userId, id);
  if (!row) throw new NotFoundError('Notification not found');
  return toNotificationDto(row);
}

export const markAllRead = async (userId: string) => ({ updated: await repo.markAllRead(userId) });
