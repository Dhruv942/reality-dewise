import { Db, insertRow } from '../db/pool';
import type { NotificationType } from '../models/types';

export interface NewNotification {
  userId: number;
  type: NotificationType;
  title: string;
  body?: string;
  leadId?: number;
  payload?: Record<string, unknown>;
}

/**
 * Business logic only depends on this interface. The default implementation stores the notification
 * (PENDING) in the same transaction as the business change; a real push/WhatsApp sender can later
 * consume those rows or replace this class without touching any service.
 */
export interface Notifier {
  notify(db: Db, n: NewNotification): Promise<void>;
}

export class DbNotifier implements Notifier {
  async notify(db: Db, n: NewNotification): Promise<void> {
    await insertRow(db, 'notifications', {
      userId: n.userId, type: n.type, title: n.title, body: n.body, leadId: n.leadId,
      payload: JSON.stringify(n.payload ?? {}),
    });
  }
}

export const notifier: Notifier = new DbNotifier();
