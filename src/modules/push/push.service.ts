import webpush from 'web-push';
import { env } from '../../config/env';
import { hasLiveSocket } from '../../realtime/socket';
import type { NotificationRow, NotificationType } from '../notifications/notification.model';
import * as repo from './push.repository';

/** Notifications that wake a closed app. Status changes and admin "lead created" stay in-app only. */
const PUSH_TYPES: readonly NotificationType[] = ['LEAD_ASSIGNED', 'LEAD_REASSIGNED', 'SLA_WARNING', 'SLA_EXPIRED'];
/** Time-critical: pushed even while the app is open (the user may be on another tab or away from the screen). */
const ALWAYS_PUSH: readonly NotificationType[] = ['SLA_WARNING', 'SLA_EXPIRED'];
const MAX_DEVICES_PER_USER = 10;
const DROP_AFTER_FAILURES = 5;
const TTL_SECONDS = 3600; // an alert that is an hour old is no longer useful

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
/** Sends one payload to one device. Rejects with `statusCode` on a push-service error. Replaced in tests. */
export type PushTransport = (target: PushTarget, payload: string, options: { TTL: number; urgency: 'high' | 'normal' }) => Promise<unknown>;

const realTransport: PushTransport = (target, payload, options) => webpush.sendNotification(target, payload, options);
let transport: PushTransport = realTransport;
export const setPushTransport = (t: PushTransport | null): void => {
  transport = t ?? realTransport;
};

if (env.pushEnabled) webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);

export const isPushEnabled = (): boolean => env.pushEnabled || transport !== realTransport;
export const getPublicKey = (): string | null => (env.pushEnabled ? env.VAPID_PUBLIC_KEY! : null);

/**
 * The browser shows this when the app is closed. It carries no customer data: the app builds the link from
 * entityType/entityId and loads the lead itself (after login) when the notification is tapped.
 */
const payloadFor = (n: NotificationRow) =>
  JSON.stringify({
    notificationId: n.id,
    type: n.type,
    title: n.title,
    body: n.message,
    tag: `${n.type}:${n.entity_id}`, // a repeat for the same lead replaces the earlier alert
    entityType: n.entity_type,
    entityId: n.entity_id,
    requireInteraction: ALWAYS_PUSH.includes(n.type),
  });

const inFlight = new Set<Promise<void>>();
/** Resolves when every push started so far has finished (tests; also handy on shutdown). */
export const pushIdle = async (): Promise<void> => {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
};

/**
 * Pushes a stored notification to the user's devices without making the caller wait. Never throws: a failed
 * push must not affect the business operation. Only called for a newly created notification, so the notification
 * dedupe key also makes the push once-per-event.
 */
export function pushNotification(n: NotificationRow): void {
  if (!isPushEnabled() || !PUSH_TYPES.includes(n.type)) return;
  if (!ALWAYS_PUSH.includes(n.type) && hasLiveSocket(n.user_id)) {
    console.log(`Push skipped (app open): ${n.type} for user ${n.user_id}`);
    return;
  }
  const job = deliver(n).catch((err) => console.error('Push failed:', err instanceof Error ? err.message : err));
  inFlight.add(job);
  void job.finally(() => inFlight.delete(job));
}

async function deliver(n: NotificationRow): Promise<void> {
  const devices = await repo.listForUser(n.user_id);
  if (devices.length === 0) return;
  const payload = payloadFor(n);
  const urgency = ALWAYS_PUSH.includes(n.type) || n.type === 'LEAD_ASSIGNED' ? 'high' : 'normal';
  await Promise.all(
    devices.map(async (d) => {
      try {
        await transport({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: TTL_SECONDS, urgency });
        await repo.markSuccess(d.id);
        console.log(`Push sent: ${n.type} id=${n.id} to a device of user ${n.user_id}`);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await repo.removeById(d.id); // the browser unsubscribed or the subscription expired
          console.log(`Push device removed (gone, ${status}): user ${n.user_id}`);
        } else if ((await repo.markFailure(d.id)) >= DROP_AFTER_FAILURES) {
          await repo.removeById(d.id);
          console.log(`Push device removed (${DROP_AFTER_FAILURES} failures): user ${n.user_id}`);
        } else {
          console.warn(`Push error ${status ?? ''} for user ${n.user_id}: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
    }),
  );
}

export async function subscribe(userId: string, sub: { endpoint: string; p256dh: string; auth: string }, userAgent: string | null): Promise<void> {
  await repo.upsert({ userId, ...sub, userAgent: userAgent?.slice(0, 300) ?? null });
  await repo.trimToNewest(userId, MAX_DEVICES_PER_USER);
  console.log(`Push device registered for user ${userId}`);
}

export const unsubscribe = (userId: string, endpoint: string) => repo.removeOwned(userId, endpoint);
/** Account deactivated / deleted / password changed: stop waking their devices. */
export const revokeUserDevices = (userId: string) => repo.removeAllForUser(userId);
