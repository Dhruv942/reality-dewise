# Frontend guide: real-time events (Socket.IO) and notifications

Socket.IO is an **extra live channel**. REST stays the way to read and change data, and PostgreSQL is the source of truth. A socket event means "something just changed, update your screen". It is never the only copy: anything you miss while offline is available over REST.

## 1. Connect

Connect to the **API server origin** (the host without `/api/v1`), default path `/socket.io`.

```bash
npm i socket.io-client
```

```ts
import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(getToken: () => string | null) {
  socket?.disconnect();
  socket = io(import.meta.env.VITE_API_ORIGIN, {      // e.g. https://api.example.com
    // A function, so every automatic reconnect uses the CURRENT token.
    auth: (cb) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectSocket() {          // call on logout
  socket?.disconnect();
  socket = null;
}
```

- Use the same access token you use for REST (`Authorization: Bearer`). One login covers both.
- Connect **after login**, disconnect on **logout**. Keep one socket for the whole app (create it once, not per component).
- Your frontend origin must be listed in `SOCKET_CORS_ORIGIN` (or `CORS_ORIGINS`) on the backend.

### Connection errors

```ts
socket.on('connect_error', (err) => {
  // err.message is one of:
  // "Authentication token missing" | "Invalid token" | "Token expired"
  // | "Session expired, please log in again" | "Authentication failed"
  // Treat all of them as "log in again". Do not retry in a loop.
});

socket.on('auth:expired', () => { /* token expired while connected: the server closes the socket. Log in again. */ });
```

Network drops reconnect automatically. Auth failures do not fix themselves, so send the user to login.

## 2. Rooms (you do not manage them)

The server puts you in rooms from your verified token. **The client cannot join or leave rooms**, so there is nothing to subscribe to.

| Role | You receive events for |
|---|---|
| ADMIN | every lead |
| MANAGER | leads of the teams you lead, plus unassigned (pending) leads |
| SALES (executive / executive manager) | only leads assigned to you |
| everyone | your own `notification:new` |

So the same code works for every portal: register the handlers and render what arrives.

## 3. Events

The `lead` object in payloads has the same shape as the lead in the REST list/detail responses, **except `isImportant` is absent** (it is a per-user flag; keep your own).

| Event | Payload | When |
|---|---|---|
| `lead:created` | `{ leadId, lead }` | A new lead was saved. If it was auto-assigned, `lead:assigned` follows right after. |
| `lead:assigned` | `{ leadId, lead, executiveId, previousExecutiveId: null, reason }` | First assignment. `reason`: `CREATED` (round-robin), `PENDING_ASSIGNED` (admin gave the property executives), `MANUAL` |
| `lead:reassigned` | `{ leadId, lead, executiveId, previousExecutiveId, reason }` | Moved to another executive. `reason`: `MANUAL` or `SLA_TIMEOUT` |
| `lead:status-updated` | `{ leadId, status, previousStatus, lead }` | A status change by anyone |
| `lead:sla-warning` | `{ leadId, executiveId, expiresAt, remainingSeconds }` | The SLA will expire soon (default last 10 minutes), once per assignment |
| `lead:sla-expired` | `{ leadId, executiveId, assignedAt }` | The SLA ran out and the lead was taken from `executiveId`. Always followed by `lead:reassigned` |
| `notification:new` | a notification (see section 4) | A notification was stored for you |

### Important details

- **The previous executive gets a slimmer `lead:reassigned`**: `{ leadId, executiveId, previousExecutiveId, reason }` with **no `lead`** (no customer data). If `payload.lead` is missing, or `previousExecutiveId === me`, **remove that lead from the executive's list**.
- **Order matters on SLA expiry**: `lead:sla-expired` then `lead:reassigned`. Use expired to show "you lost this lead", reassigned to update lists.
- **`lead:sla-warning.remainingSeconds`** is for display only. Do not drive the SLA from a browser timer: the backend owns the SLA and reassigns even with the browser closed. If you show a countdown, start it from `expiresAt` and let the server events be the truth.
- A new lead for an executive arrives as `lead:created` **and** `lead:assigned`. Key your list by `leadId` and upsert, so receiving both is harmless.
- Pending leads (no executive) are sent to admins and managers only. Executives never hear about them until they are assigned.
- Events are not replayed. After a reconnect, refetch (section 5).

### Handler example

```ts
const upsert = (lead) => leadStore.upsert(lead);
const remove = (leadId: string) => leadStore.remove(leadId);

socket.on('lead:created',  ({ lead }) => upsert(lead));
socket.on('lead:assigned', ({ lead }) => upsert(lead));
socket.on('lead:reassigned', (p) => {
  if (!p.lead || p.previousExecutiveId === me.id) remove(p.leadId);   // I lost it
  else upsert(p.lead);
});
socket.on('lead:status-updated', ({ lead }) => upsert(lead));
socket.on('lead:sla-warning', ({ leadId, expiresAt }) => showSlaBanner(leadId, expiresAt));
socket.on('lead:sla-expired', ({ leadId }) => toast('A lead was taken from you (SLA expired)'));
socket.on('notification:new', (n) => { notificationStore.prepend(n); badge.increment(); });
```

Register handlers **once**, right after creating the socket. Registering inside a component that re-renders gives you duplicate handlers and double toasts. In React, do it in an effect and clean up with `socket.off(...)`.

## 4. Notifications

Every `notification:new` is already saved in the database. The bell/inbox is built from REST; the socket only adds new ones live.

```ts
interface Notification {
  id: string;
  type: 'LEAD_CREATED' | 'LEAD_ASSIGNED' | 'LEAD_REASSIGNED' | 'LEAD_STATUS_UPDATED' | 'SLA_WARNING' | 'SLA_EXPIRED';
  title: string;
  message: string;
  entityType: 'LEAD';
  entityId: string;        // the lead id: link to the lead
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}
```

| Type | Who gets it |
|---|---|
| `LEAD_ASSIGNED` | the executive the lead was assigned to |
| `LEAD_REASSIGNED` | the new executive; the previous one after a manual move; admin and the managers in scope when the SLA moved a lead |
| `LEAD_STATUS_UPDATED` | the assigned executive, when someone else changed the status |
| `SLA_WARNING` | the assigned executive |
| `SLA_EXPIRED` | the executive who lost the lead |
| `LEAD_CREATED` | admins and managers, only for a lead that is still unassigned |

### REST API (any logged-in user, own notifications only)

Base `/api/v1`, header `Authorization: Bearer <token>`.

| Call | Notes |
|---|---|
| `GET /notifications?unread=true&limit=50&offset=0` | Returns `{ unreadCount, notifications: Notification[] }`, newest first. `limit` 1-100 (default 50) |
| `PATCH /notifications/:id/read` | Returns the updated notification. Safe to repeat. Someone else's or unknown id returns `404` |
| `PATCH /notifications/read-all` | Returns `{ updated: number }` |

Typical use: load `GET /notifications` when the app starts to fill the bell and the badge (`unreadCount`). Prepend each `notification:new` that arrives. On click, call `PATCH …/read` and navigate to the lead using `entityId`.

## 5. Reconnect checklist

Events sent while you were offline or reconnecting are **not** replayed, and reconnecting never creates notifications. On every `connect` (the first one and every reconnect), resync from REST:

```ts
socket.on('connect', () => {
  refetchNotifications();   // GET /notifications  -> bell + badge
  refetchLeads();           // your existing list call (executive: use ?assignedSince=<last assignedAt you saw> if you want a delta)
});
```

This makes the UI correct no matter what was missed. Socket events only make it faster.

## 6. Do's and don'ts

- Do keep one socket per logged-in session and disconnect on logout.
- Do upsert by `leadId` and tolerate duplicate or out-of-order events.
- Do treat REST as the truth when the two disagree.
- Don't try to join rooms or send events: the server ignores anything the client emits.
- Don't run SLA timers in the browser, and don't compute assignments client-side.
- Don't store the token anywhere new for the socket: reuse the REST token via `getToken()`.

## 7. Quick test without the app

With a valid token (from `POST /api/v1/auth/<portal>/login`):

```ts
import { io } from 'socket.io-client';
const s = io('http://localhost:4000', { auth: { token } });
s.onAny((event, payload) => console.log(event, payload));
```

Then create a lead from another client (`POST /api/v1/admin/leads`) and watch the events arrive.
