# Frontend guide: Web Push (notifications when the app is closed)

The backend sends a browser push for these notifications: `LEAD_ASSIGNED`, `LEAD_REASSIGNED`, `SLA_WARNING`, `SLA_EXPIRED`.
It skips the push while the user has the app open (a live socket) **except** for the two SLA types, which always push.
Status changes and admin "lead created" notifications stay in-app only.

## What works where

| Device | Works with the app closed? |
|---|---|
| Android Chrome / Edge / Firefox | Yes |
| Desktop Chrome / Edge / Firefox | Yes, while the browser is running (can be minimized) |
| iPhone / iPad (iOS 16.4+) | Only if the portal is **installed to the Home Screen** (PWA) |
| Requirement | HTTPS in production (localhost is fine for development) |

## 1. API (base `/api/v1`, `Authorization: Bearer <token>`, any role)

| Call | Body | Result |
|---|---|---|
| `GET /push/public-key` | | `{ publicKey }`. `503` means push is not configured on the server: hide the toggle |
| `POST /push/subscriptions` | the browser's `subscription.toJSON()`: `{ endpoint, expirationTime, keys: { p256dh, auth } }` | `201`. Safe to repeat. If another user registered the same browser, it moves to the current user |
| `DELETE /push/subscriptions` | `{ endpoint }` | `{ removed: boolean }`. Call on logout |

Max 10 devices per user (oldest dropped). Nothing returns subscriptions to the client.

## 2. Push payload (what the service worker receives)

```json
{
  "notificationId": "uuid",
  "type": "LEAD_ASSIGNED",
  "title": "New Lead Assigned",
  "body": "Lead #123 (Property name) has been assigned to you.",
  "tag": "LEAD_ASSIGNED:<leadId>",
  "entityType": "LEAD",
  "entityId": "<leadId>",
  "requireInteraction": false
}
```

No customer data is included. Build the link yourself from `entityType` / `entityId`.

## 3. Service worker: `public/sw.js` (served from the site root)

```js
self.addEventListener('push', (event) => {
  const n = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(n.title || 'Notification', {
      body: n.body,
      tag: n.tag,                       // a repeat for the same lead replaces the earlier alert
      renotify: true,
      requireInteraction: !!n.requireInteraction,   // SLA alerts stay until tapped
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      data: { entityType: n.entityType, entityId: n.entityId, notificationId: n.notificationId },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { entityType, entityId } = event.notification.data || {};
  const url = entityType === 'LEAD' ? `/leads/${entityId}` : '/';   // use your real lead route per role
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) if ('focus' in w) { w.navigate(url); return w.focus(); }
      return self.clients.openWindow(url);
    }),
  );
});
```

If the user is logged out when they tap, your normal login redirect should return them to that URL afterwards.

## 4. Subscribe (after login, from a button, never on page load)

```ts
const urlB64ToUint8Array = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush(api) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if ((await Notification.requestPermission()) !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.get('/push/public-key');          // 503 -> push not configured
  const sub = (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) }));
  await api.post('/push/subscriptions', sub.toJSON());               // call on every login too (re-binds the device)
  return 'enabled';
}

export async function disablePush(api) {                              // on logout or when the user turns it off
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.delete('/push/subscriptions', { endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
}
```

## 5. UX checklist
- Show an "Enable notifications" banner after login. Explain why (new leads, SLA warnings), then call `enablePush` from the click.
- If permission is `denied`, show how to re-enable it in browser settings (the page cannot ask again).
- On iPhone, show "Add to Home Screen, then open the app from there, then enable notifications" (needs `manifest.json` with `display: "standalone"` and icons).
- On every login, if permission is `granted`, silently call `enablePush` again so a shared browser is bound to the right user.
- On logout, call `disablePush` **before** clearing the token.
- Keep using the Socket.IO events and `GET /notifications` for the in-app bell. Push is only the closed-app channel.

## 6. Testing
1. Run the backend with VAPID keys set. Log in, click enable, check the server log for `Push device registered`.
2. Close the tab (or the whole browser on Android). From another browser as admin, create a lead for that executive.
3. The OS notification appears. The server log shows `Push sent: LEAD_ASSIGNED …`.
4. Tap it: the app opens the lead.
