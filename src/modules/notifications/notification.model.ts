export const NOTIFICATION_TYPES = ['LEAD_CREATED', 'LEAD_ASSIGNED', 'LEAD_REASSIGNED', 'LEAD_STATUS_UPDATED', 'SLA_WARNING', 'SLA_EXPIRED'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  is_read: boolean;
  created_at: Date;
  read_at: Date | null;
}

export const toNotificationDto = (n: NotificationRow) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  message: n.message,
  entityType: n.entity_type,
  entityId: n.entity_id,
  isRead: n.is_read,
  createdAt: n.created_at,
  readAt: n.read_at,
});
