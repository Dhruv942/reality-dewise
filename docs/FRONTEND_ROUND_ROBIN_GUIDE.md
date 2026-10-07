# Round Robin Lead Assignment: Frontend Guide

Everything the frontend needs for lead assignment: how leads are shared out (round robin), the admin-only settings, the 90-minute SLA, manual assignment, and what each role sees. Every API involved is listed here with requests, responses and errors.

## Contents

1. [How it works in one page](#1-how-it-works-in-one-page)
2. [Basics: base URL, auth, errors](#2-basics)
3. [Statuses and the lead fields that matter](#3-statuses-and-the-lead-fields-that-matter)
4. [Admin APIs](#4-admin-apis)
   - 4.1 Assignment rule setting
   - 4.2 SLA (timeout) setting
   - 4.3 Executives for the picker
   - 4.4 Properties and their executive list
   - 4.5 Creating leads (this is what triggers round robin)
   - 4.6 Pending leads
   - 4.7 Assigning by hand
   - 4.8 Assignment history
5. [Manager APIs](#5-manager-apis)
6. [Executive APIs](#6-executive-apis)
7. [Screens to build](#7-screens-to-build)
8. [Recipes (code)](#8-recipes)
9. [How to test it in the browser](#9-how-to-test-it-in-the-browser)
10. [Quick reference and error cheat sheet](#10-quick-reference)

---

## 1. How it works in one page

- A **property** has a **hand-picked list of executives**, set by the admin.
- When a lead arrives for that property, the system gives it to the **next executive in that list**, one after another, wrapping around: Amit → Rahul → Priya → Amit → … This is **round robin**.
- Round robin is the **default and only rule** today. It is a system setting; **only an admin can read or change it** (managers and executives get `403`).
- **Order** = the order the executives' accounts were created (oldest first), not the order they were ticked in the picker. Each property keeps **its own position**.
- **Inactive executives are skipped** and rejoin the rotation when reactivated.
- If the property has **nobody to give the lead to**, the lead is saved as **`PENDING_ASSIGNMENT`**. It is assigned automatically, oldest first, as soon as the admin picks executives for that property.
- **SLA (timeout):** the executive must handle the lead (move its status away from `INCOMING`) within **90 minutes**, counted **24/7**. If not, the lead moves to the next executive in the rotation, and so on, until someone handles it. The admin can change the 90 minutes for special cases.
- An admin or a manager can also **assign a lead by hand**. That overrides the rule for that lead, restarts its SLA clock, and does not change whose turn it is.

```
Lead arrives (POST /admin/leads)
   → property found/created by name
   → active rule (ROUND_ROBIN): next executive of THAT property's list
        ├─ someone available → lead goes to them, status INCOMING, SLA clock starts
        └─ nobody            → status PENDING_ASSIGNMENT (+ notice); assigned when the admin picks executives
   → still INCOMING after 90 min? → next executive (clock restarts) → … until someone changes the status
```

---

## 2. Basics

- **Base URL:** `http://localhost:4000/api/v1` locally. Live: `https://reality-dewise.onrender.com/api/v1` (the free tier sleeps when idle, so the first call can take ~30 s: show a loader).
- **Format:** JSON in and out; send `Content-Type: application/json` on requests with a body.
- **Auth:** log in, then send `Authorization: Bearer <accessToken>` on every other call. The token lasts 1 hour (no refresh token): on `401`, go back to login.

| Role | Login | Area |
|---|---|---|
| Admin (`ADMIN`) | `POST /auth/admin/login` | `/admin/*` |
| Manager (`MANAGER`) | `POST /auth/manager/login` | `/manager/*` |
| Executive (`SALES`: sales executives and executive managers) | `POST /auth/executive/login` | `/executive/*` |

Login body: `{ "email": "…", "password": "…" }` **or** `{ "username": "…", "password": "…" }`. Response: `{ "accessToken": "…", "user": { "id", "name", "email", "role", "designation" } }`. Route the user by `user.role`. A token only works in its own area (wrong area = `403`).

**Errors** always look like `{ "success": false, "message": "…" }`; validation errors (`400`) add `"errors": [{ "field", "message" }]` to show next to inputs.

| Status | Meaning |
|---|---|
| 400 | Validation failed, bad value, or unknown fields |
| 401 | No, invalid or expired token; wrong credentials |
| 403 | Wrong role for this area (for example a manager calling `/admin/settings/...`) |
| 404 | Not found, or not visible to you |
| 409 | Conflict (inactive property or executive, and similar) |

Ids are UUID strings, dates are ISO strings (UTC). Lists are plain arrays; lead lists accept `limit` (1-200, default 50) and `offset`. The browser must be allowed by the backend's `CORS_ORIGINS` (methods `GET, POST, PUT, PATCH, DELETE`).

---

## 3. Statuses and the lead fields that matter

| Status | Label | Meaning |
|---|---|---|
| `PENDING_ASSIGNMENT` | Pending assignment | **System status.** The property has no available executive yet. Cannot be set by hand |
| `INCOMING` | Incoming | Assigned to an executive, **not handled yet**. The SLA clock runs only in this status |
| `RINGING` | Ringing | Executive is calling, no answer yet |
| `CONNECTED` | Connected | Spoke to the client |
| `CLOSED` | Closed | Deal done |
| `LOST` | Lost | Client dropped out |
| `BROKER` | Broker | The enquiry is from a broker |

**Handled = the status moved out of `INCOMING`** (to any other real status). Opening a lead does **not** count as handling it.

Lead fields used by assignment screens (every lead object has these):

```json
{
  "id": "uuid",
  "leadNo": 8439,
  "status": "INCOMING",
  "source": "MAGICBRICKS",
  "customer": { "id": "uuid", "name": "Sunita C Sinha", "mobile": "+919867613605", "email": null, "type": "INDIVIDUAL" },
  "property": { "id": "uuid", "name": "Rustomjee Oriana / Seasons", "location": "Bandra East" },
  "requirement": "3 BHK on Rent",
  "budget": 250000,
  "assignedExecutive": { "id": "uuid", "name": "Hitesh" },
  "isNew": true,
  "assignedAt": "2026-10-06T09:15:00.000Z",
  "createdAt": "2026-10-06T09:15:00.000Z",
  "isImportant": false
}
```

| Field | Use |
|---|---|
| `assignedExecutive` | Who has the lead now. `null` while `PENDING_ASSIGNMENT` |
| `assignedAt` | When it was assigned to the **current** executive. It is also **the start of the SLA clock**, and it changes on every reassignment (by round robin, by hand, or by timeout) |
| `isNew` | `true` for the assigned executive until they first open the lead (the "New / Assigned to you" tag) |
| `status` | `INCOMING` means the SLA is running |
| `isImportant` | The logged-in user's own star. It has **no effect** on assignment or the SLA |

**SLA deadline on screen:** `assignedAt + 90 minutes` while `status === "INCOMING"`. The 90 comes from the admin setting (section 4.2). Only admins can read that setting, so executive and manager screens can show the deadline only if you ship the 90 with the app or the backend adds it to the lead; see the note in section 6.

---

## 4. Admin APIs

Token: `ADMIN`. Everything is under `/admin`.

### 4.1 Assignment rule setting

| Method | Path | Body |
|---|---|---|
| GET | `/admin/settings/assignment-rule` | none |
| PUT | `/admin/settings/assignment-rule` | `{ "rule": "ROUND_ROBIN" }` |

Admin only: manager or executive tokens get `403`, no token `401`.

Response (GET and PUT):

```json
{
  "rule": "ROUND_ROBIN",
  "defaultRule": "ROUND_ROBIN",
  "isDefault": true,
  "availableRules": [
    { "value": "ROUND_ROBIN", "label": "Round robin",
      "description": "New leads go to the executives picked for the lead's property one after another, in order, skipping inactive ones." }
  ],
  "updatedAt": null,
  "updatedBy": null
}
```

- `rule` is the rule in force. Round robin is the **default** with nothing configured: a fresh install assigns leads correctly with no admin action.
- Build the picker from `availableRules` (use `label` and `description`) so new rules appear without a frontend change. Today it has one option.
- `updatedAt` / `updatedBy` (`{ id, name }`) are `null` until an admin saves it for the first time.
- `PUT` errors: `400` if `rule` is missing, not exactly one of `availableRules[].value` (case matters), or the body has extra fields (message like `Rule must be one of: ROUND_ROBIN`). Saving the rule that is already active is fine (`200`).
- It applies from the **next** lead that is assigned. Saving it never resets a property's rotation or moves leads that are already assigned.

### 4.2 SLA (timeout) setting

| Method | Path | Body |
|---|---|---|
| GET | `/admin/settings/lead-timeout` | none |
| PUT | `/admin/settings/lead-timeout` | `{ "minutes": 90 }` |

Admin only (managers and executives `403`, no token `401`).

```json
{ "minutes": 90, "defaultMinutes": 90, "isDefault": true,
  "minMinutes": 1, "maxMinutes": 10080, "updatedAt": null, "updatedBy": null }
```

- **Default 90 minutes**, running **24/7**: nights, weekends and holidays count; there are no working hours.
- `PUT` needs a **whole number** from `minMinutes` to `maxMinutes` (`400` for a fraction, a string, below 1, above 10080, a missing field, or extra fields). Use it for special cases; set `90` to go back to the default (`isDefault` becomes `true`).
- A change applies from the next check (the system looks every minute); leads already assigned are measured against the new value.

**The SLA rules to show on the settings screen:**
1. The clock starts when the lead is assigned to an executive (automatically or by hand).
2. It runs only while the lead is `INCOMING` and **stops as soon as the status changes** to any other status. Opening the lead alone does not stop it.
3. If it is still `INCOMING` when the time is up, the lead moves to the **next eligible executive** by round robin (never the one who has it now, inactive executives skipped), and the new executive's clock starts then. This repeats until someone handles it.
4. If nobody else is eligible (one executive on the property, the rest inactive, or the property is inactive) the lead stays where it is.
5. Assigning by hand restarts the clock. Starring a lead does not affect it.

### 4.3 Executives (for the picker)

`GET /admin/executives?isActive=true` returns the active sales executives and executive managers (never managers or admins). Filters: `teamId`, `isActive`, `search`.

```json
[ { "id": "uuid", "name": "Amit", "username": "amit", "role": "SALES", "designation": "SALES_EXECUTIVE",
    "isActive": true, "team": { "id": "uuid", "name": "Team A", "isActive": true }, "…": "…" } ]
```

Show `designation` (`SALES_EXECUTIVE` / `EXECUTIVE_MANAGER`) as a badge. It is display only: both have the same permissions.

### 4.4 Properties and their executive list

Admins do not create properties: a property is created automatically the first time a lead names it. The admin's job is to pick its executives.

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/properties` | Filters `assigned=false` (needs executives), `isActive`, `search` |
| GET | `/admin/properties/:id` | Property plus its `executives` |
| PUT | `/admin/properties/:id/executives` | **Set the executive list** (below) |
| PATCH | `/admin/properties/:id/status` | `{ "isActive": false }`. An inactive property rejects new leads (`409`) |
| PATCH | `/admin/properties/:id` | `name`, `description`, `location`, `isActive` |

Property object:

```json
{ "id": "uuid", "name": "Green Valley Residency", "description": null, "location": null,
  "isActive": true, "isStub": true,
  "assignedExecutiveCount": 0, "needsAssignment": true, "pendingLeadCount": 7,
  "createdAt": "…", "updatedAt": "…" }
```

- `needsAssignment: true`: no executives picked, so its leads are `PENDING_ASSIGNMENT`. `pendingLeadCount` is how many are waiting.
- `isStub: true`: created automatically from a lead; nobody has filled in its details.
- `GET /admin/properties/:id` adds `executives: [{ id, name, username, isActive }]`.

**`PUT /admin/properties/:id/executives`**, body `{ "executiveIds": ["<id>", "<id>", "<id>"] }`:

- The list is **replaced**, not appended: always send the full list. `[]` removes everyone (the property then needs assignment).
- Only active executives are accepted (`400` unknown / not an executive, `409` inactive). Duplicate ids are ignored.
- **Waiting leads are assigned immediately**, oldest first, by round robin, and the rotation continues afterwards. The response is the property (with `executives`) plus `"assignedPendingLeads": 7`. Show *"7 waiting leads were assigned"* when it is above 0.
- Adding or removing executives never resets the rotation; it carries on from the last executive who got a lead.
- Build the control as a multi-select fed by the list in 4.3. Helper text: *"Leads are shared among these executives in turn, in the order their accounts were created."*

### 4.5 Creating leads (this triggers round robin)

`POST /admin/leads`:

```json
{ "name": "Sunita C Sinha", "mobile": "9867613605", "email": "s@example.com",
  "propertyName": "Rustomjee Oriana / Seasons", "source": "MAGICBRICKS",
  "requirement": "3 BHK on Rent", "budget": 250000, "enquiryType": "RENT",
  "message": "Looking for a rental", "externalLeadId": "ENQ-1001" }
```

| Field | Rules |
|---|---|
| `name`, `mobile`, `propertyName`, `source` | required. `source` is `99ACRES` or `MAGICBRICKS` |
| `requirement` | optional text, max 200 |
| `budget` | optional number in rupees |
| `enquiryType` | optional `RENT` or `BUY` (any casing). Stored on this lead; the same client can have a rent and a buy enquiry. Returned as `enquiryType` (`null` when not sent). **Replaces `customerType`, which no longer exists** (sending it returns `400`, and `customer.type` is no longer returned) |
| `email`, `message` (max 2000), `externalLeadId` | optional. The same `source` + `externalLeadId` again returns the existing lead (`200`) |
| anything else | `400` |

What happens: the client is found by mobile or created, the property is found by its name (any casing and spacing) or created once, then the active rule picks the executive.

| Response | Meaning |
|---|---|
| `201` + lead with `status: "INCOMING"`, `assignedExecutive` set | Assigned by round robin; the SLA clock started |
| `201` + lead with `status: "PENDING_ASSIGNMENT"`, `assignedExecutive: null`, plus **`notice`** | Nobody to give it to |
| `200` + the existing lead | Same `externalLeadId` seen before (no duplicate, no turn used) |
| `409` | The property is inactive (nothing stored) |

`notice` text: *"No executive/team is assigned to X. Please assign an executive/team before processing this lead."* Show it as a warning with a link to that property's executive picker.

### 4.6 Pending leads

- `GET /admin/leads?status=PENDING_ASSIGNMENT` lists the leads waiting for an executive.
- `GET /admin/properties?assigned=false` lists the properties that need executives, with `pendingLeadCount`: the best starting point for an admin to-do list.
- A pending lead cannot change status until it has an executive (`409`).

### 4.7 Assigning by hand

`PATCH /admin/leads/:id/assign`, body `{ "executiveId": "<id>" }`.

- Works for a pending lead (first assignment) and for **reassigning**. A pending lead becomes `INCOMING`; a lead that already had an executive keeps its status.
- The target must be an active executive (`400` unknown / an admin / a manager, `409` inactive). `404` if the lead does not exist.
- The new executive sees it as new (`isNew: true`, fresh `assignedAt`), the **SLA clock restarts**, and **round robin is not disturbed** (whose turn it is next does not change).
- Assigning to the executive who already has it changes nothing (`200`).
- Returns the updated lead.

### 4.8 Assignment history

`GET /admin/properties/:id/assignment-history?limit=50&offset=0`:

```json
{ "property": { "id": "uuid", "name": "Green Valley Residency" }, "limit": 50, "offset": 0,
  "history": [
    { "id": "uuid", "propertyId": "uuid", "leadId": "uuid",
      "executive": { "id": "uuid", "name": "Rahul", "username": "rahul" },
      "method": "TIMEOUT", "assignedBy": null, "createdAt": "…" } ] }
```

| `method` | Meaning | `assignedBy` |
|---|---|---|
| `ROUND_ROBIN` | Assigned automatically when the lead arrived (or when waiting leads were assigned) | `null` |
| `TIMEOUT` | The SLA ran out and the system moved the lead to the next executive | `null` |
| `MANUAL` | An admin or manager assigned it | `{ id, name }` of that person |

Newest first. Suggested labels: *Automatic (round robin)*, *Reassigned automatically (not handled in 90 minutes)*, *Assigned by {name}*.

---

## 5. Manager APIs

Token: `MANAGER`, under `/manager`. A manager **cannot** read or change the assignment rule or the SLA (`403`), and cannot create executives or leads. A manager works with the leads of the executives in the teams they lead, plus leads nobody has been assigned yet.

| Method | Path | Notes |
|---|---|---|
| GET | `/manager/teams` | The teams they lead |
| GET | `/manager/executives` | The executives in those teams (the "assign to" list) |
| GET | `/manager/leads` | Their teams' leads **plus unassigned (`PENDING_ASSIGNMENT`) leads**. Filters: `status`, `executiveId`, `propertyId`, `search`, `important`, `isNew`, `assignedSince`, `limit`, `offset` |
| GET | `/manager/leads/:id` | Lead detail with the client's history |
| PATCH | `/manager/leads/:id/assign` | Assign / reassign: `{ "executiveId": "<id>" }` |

Assign rules:
- The lead must be in the manager's scope (their teams' leads or an unassigned one), otherwise `404`.
- The executive must be **in a team this manager leads** and active, otherwise `403` (not in their teams), `409` (inactive), `400` (unknown / admin / manager).
- Same effects as admin assignment (4.7): a pending lead becomes `INCOMING`, a reassigned lead keeps its status, the executive sees it as new, the SLA restarts, the rotation is unchanged, and history records `MANUAL` with the manager as `assignedBy`.

Notes for the manager screens:
- A **Needs assignment** tab: `GET /manager/leads?status=PENDING_ASSIGNMENT`.
- A lead can leave an executive's list **without any action by the manager** when the SLA moves it. The manager's list reflects it (use `?executiveId=` for one executive's view), and the lead's history shows `TIMEOUT`.
- To spot leads that are close to the SLA, filter `status=INCOMING` and compare `assignedAt + 90 minutes` with the current time.

---

## 6. Executive APIs

Token: `SALES`, under `/executive`. An executive only ever sees **their own** leads (someone else's lead returns `404`). The same app serves sales executives and executive managers.

| Method | Path | Notes |
|---|---|---|
| GET | `/executive/leads/summary` | Dashboard numbers: `{ "newLeads": 3, "totalLeads": 12, "byStatus": { "INCOMING": 5, "CONNECTED": 4 } }` |
| GET | `/executive/leads` | My leads. Unopened (new) ones first, then most recently assigned. Pending leads never appear. Filters: `status`, `isNew=true`, `assignedSince=<ISO>`, `search`, `important`, `limit`, `offset` |
| GET | `/executive/leads/:id` | Lead + client history. **Opening it clears `isNew`**; it does **not** stop the SLA |
| PATCH | `/executive/leads/:id/status` | `{ "status": "RINGING" }`. **This is what stops the SLA** |

**What the executive must know (show it in the UI):**
- *"Update the status within 90 minutes or the lead moves to the next executive."* Opening the lead is not enough: the status must leave `INCOMING`.
- If the SLA runs out, the lead disappears from their list (its id now returns `404`) and shows up as new for the next executive.
- Setting a lead back to `INCOMING` does **not** restart its clock: it is measured from `assignedAt`.

**Executives cannot read the SLA setting** (admin only). To show a countdown, either hard-code 90 in the app (the default) or ask the backend to add a `respondBy` time to the lead object. A countdown is `assignedAt + 90 min − now`, shown only while `status === "INCOMING"`.

### "A new lead has been assigned to you" (no push yet: poll)

A lead reaches an executive through round robin, a manual assignment, or a reassignment after a timeout. In all three cases it appears as new with a fresh `assignedAt`, so one polling loop covers everything:

1. **Badge:** every 10-15 s, call `GET /executive/leads/summary` and show `newLeads`.
2. **Toast:** remember the newest `assignedAt` you showed, then call `GET /executive/leads?assignedSince=<that value>`. Anything returned is newly assigned: show *"New lead assigned: Sunita C Sinha · Rustomjee Oriana / Seasons · 3 BHK on Rent · ₹2.5 Lakh · Magicbricks"*.
3. **List:** unopened leads sort first and carry `isNew: true` (the *New* tag) until opened.
4. A lead that was waiting as `PENDING_ASSIGNMENT` becomes new for the executive the moment it is assigned.
5. A lead the SLA took away simply stops appearing in the list; refresh the list on every poll so it disappears.

---

## 7. Screens to build

| Role | Screen | APIs |
|---|---|---|
| Admin | **Settings → Lead assignment**: current rule (from `availableRules`), Default badge, "last changed by", Save; the SLA minutes input (min/max from the response, Default badge, Save); the SLA rules text | 4.1, 4.2 |
| Admin | **Properties needing assignment**: list with `pendingLeadCount`, *Assign executives* opens the multi-select, shows "N waiting leads were assigned" | 4.4, 4.3 |
| Admin | **Property details**: its executives, assignment history with `ROUND_ROBIN` / `TIMEOUT` / `MANUAL` labels | 4.4, 4.8 |
| Admin | **Add lead** form and result: shows the assigned executive, or the pending `notice` with a link to the picker | 4.5 |
| Admin | **Pending leads** tab and **Assign to…** on a lead | 4.6, 4.7 |
| Manager | **Needs assignment** tab, per-executive lead view, **Assign to…** (choices from `/manager/executives`) | 5 |
| Executive | **Dashboard**: new-lead badge and toast (polling), SLA reminder | 6 |
| Executive | **My leads**: status tabs, *New* tag, status dropdown that moves a lead out of `INCOMING`, SLA countdown (optional) | 6 |

---

## 8. Recipes

### Small API client

```js
const API = 'http://localhost:4000/api/v1';
let token = sessionStorage.getItem('token');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && token) { sessionStorage.removeItem('token'); location.assign('/login'); }
  if (!res.ok) throw Object.assign(new Error(data?.message ?? 'Request failed'), { status: res.status, errors: data?.errors });
  return data;
}

export async function login(portal /* 'admin' | 'manager' | 'executive' */, identity /* { email } | { username } */, password) {
  const { accessToken, user } = await api(`/auth/${portal}/login`, { method: 'POST', body: { ...identity, password } });
  token = accessToken; sessionStorage.setItem('token', token);
  return user; // route by user.role
}
```

### Admin: read and save the rule and the SLA

```js
const rule = await api('/admin/settings/assignment-rule');
// render rule.availableRules as radios (label + description), preselect rule.rule, badge when rule.isDefault
await api('/admin/settings/assignment-rule', { method: 'PUT', body: { rule: selectedValue } });

const sla = await api('/admin/settings/lead-timeout');       // { minutes: 90, isDefault: true, minMinutes, maxMinutes, ... }
await api('/admin/settings/lead-timeout', { method: 'PUT', body: { minutes: Number(input) } }); // whole number!
```

### Admin: pick the executives for a property

```js
const [executives, property] = await Promise.all([
  api('/admin/executives?isActive=true'),
  api(`/admin/properties/${id}`),
]);
const saved = await api(`/admin/properties/${id}/executives`, {
  method: 'PUT', body: { executiveIds: selectedIds },      // always the full list; [] removes everyone
});
if (saved.assignedPendingLeads > 0) toast(`${saved.assignedPendingLeads} waiting leads were assigned`);
```

### Admin or manager: assign a lead by hand

```js
const area = user.role === 'ADMIN' ? 'admin' : 'manager';
const updated = await api(`/${area}/leads/${leadId}/assign`, { method: 'PATCH', body: { executiveId } });
// 403 (manager): executive not in their teams, 409: executive inactive
```

### Executive: poll for new leads

```js
let since = null;                                   // newest assignedAt already shown
async function poll() {
  const { newLeads } = await api('/executive/leads/summary');
  setBadge(newLeads);
  const fresh = await api('/executive/leads?isNew=true' + (since ? `&assignedSince=${encodeURIComponent(since)}` : ''));
  if (since) fresh.forEach(showNewLeadToast);       // no toasts on the first load
  if (fresh.length) since = fresh.map((l) => l.assignedAt).sort().at(-1);
  else if (!since) since = new Date().toISOString();
  refreshList();                                    // a lead the SLA took away must disappear
}
setInterval(poll, 12000);
```

### Executive: handle a lead (stops the SLA) and show the deadline

```js
await api(`/executive/leads/${id}/status`, { method: 'PATCH', body: { status: 'RINGING' } });

const SLA_MINUTES = 90;                             // default; admins can change it, executives cannot read it
const deadline = (lead) => lead.status === 'INCOMING' ? new Date(new Date(lead.assignedAt).getTime() + SLA_MINUTES * 60000) : null;
```

### Labels

```js
const STATUS_LABEL = { PENDING_ASSIGNMENT: 'Pending assignment', INCOMING: 'Incoming', RINGING: 'Ringing',
                       CONNECTED: 'Connected', CLOSED: 'Closed', LOST: 'Lost', BROKER: 'Broker' };
const METHOD_LABEL = { ROUND_ROBIN: 'Automatic (round robin)', TIMEOUT: 'Reassigned automatically (not handled in time)', MANUAL: 'Assigned by hand' };
const formatBudget = (n) => n == null ? '' : n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(2)} Lakh` : `₹${n.toLocaleString('en-IN')}`;
```

---

## 9. How to test it in the browser

Use two or three browser profiles: one admin, two executives (A and B). In development the backend also serves a form-based tester at `/test-console`.

**A. Round robin**
1. As admin, send `PUT /admin/properties/:id/executives` with executives A and B (and C if you like).
2. Create 4 leads for that property. Expect them to go A, B, C, A (accounts' creation order). Check each lead's `assignedExecutive`.
3. Deactivate B (`PATCH /admin/executives/:id/status`) and create another lead: B is skipped. Reactivate B and it rejoins.

**B. Pending**
1. Create a lead for a property with **no** executives. Expect `status: "PENDING_ASSIGNMENT"`, `assignedExecutive: null` and a `notice`.
2. `PUT` executives for that property: the response shows `assignedPendingLeads`, and the lead is now `INCOMING`.

**C. Admin-only settings**
1. As admin, `GET /admin/settings/assignment-rule` and `/lead-timeout`: rule `ROUND_ROBIN`, minutes `90`, both `isDefault: true`.
2. As a manager and as an executive, call the same endpoints and a `PUT`: all `403`.

**D. The 90-minute SLA** (waiting 90 minutes is slow, so shorten it for the test)
> The SLA is **global**. On a database with real leads, a short SLA would reassign every `INCOMING` lead older than that. Do this on a dev/test database, or when no real leads are `INCOMING`.
1. Admin: `PUT /admin/settings/lead-timeout` with `{ "minutes": 2 }`.
2. Create a lead; it goes to A (`INCOMING`). As A, **do not change the status** (opening it is fine).
3. Wait 2 to 3 minutes (the check runs every minute). Refresh:
   - A: the lead is gone; its id returns `404`.
   - B: the lead appears with `isNew: true` and a fresh `assignedAt`; `/executive/leads/summary` shows `newLeads` up by 1.
   - Admin: the property's assignment history has a `TIMEOUT` entry with `assignedBy: null`.
4. As B, set the status to `RINGING`. Wait past the SLA again: the lead stays with B, and there is no new `TIMEOUT` entry.
5. Restore: `PUT /admin/settings/lead-timeout` with `{ "minutes": 90 }` (`isDefault` returns to `true`).

**E. Manual assignment**
1. As admin, assign a lead to executive C with `PATCH /admin/leads/:id/assign`: C sees it as new, the history shows `MANUAL`, and the next automatic lead still goes to whoever was next in the rotation.
2. As a manager, assign a lead to an executive of their team (works) and to an executive of another team (`403`).

---

## 10. Quick reference

| Who | Method | Path | Purpose |
|---|---|---|---|
| Admin | GET / PUT | `/admin/settings/assignment-rule` | Read / change the rule (default `ROUND_ROBIN`) |
| Admin | GET / PUT | `/admin/settings/lead-timeout` | Read / change the SLA minutes (default 90, 24/7) |
| Admin | GET | `/admin/executives?isActive=true` | Executives for the picker |
| Admin | GET | `/admin/properties`, `?assigned=false` | Properties, and those needing executives |
| Admin | GET | `/admin/properties/:id` | Property + its executives |
| Admin | PUT | `/admin/properties/:id/executives` | Set the executive list; assigns waiting leads |
| Admin | GET | `/admin/properties/:id/assignment-history` | `ROUND_ROBIN` / `TIMEOUT` / `MANUAL` history |
| Admin | POST | `/admin/leads` | Create a lead (round robin runs) |
| Admin | GET | `/admin/leads?status=PENDING_ASSIGNMENT` | Pending leads |
| Admin | PATCH | `/admin/leads/:id/assign` | Assign / reassign by hand |
| Manager | GET | `/manager/teams`, `/manager/executives` | Their teams and the executives in them |
| Manager | GET | `/manager/leads`, `/manager/leads/:id` | Their teams' leads + unassigned |
| Manager | PATCH | `/manager/leads/:id/assign` | Assign within their teams |
| Executive | GET | `/executive/leads/summary` | Badge counts |
| Executive | GET | `/executive/leads`, `/executive/leads/:id` | Their leads; opening clears `isNew` |
| Executive | PATCH | `/executive/leads/:id/status` | Handle the lead (stops the SLA) |

| Situation | Result |
|---|---|
| Manager or executive calls a settings endpoint | `403` |
| Rule not one of `availableRules`, or SLA not a whole number 1-10080 | `400` |
| Lead for an inactive property | `409`, nothing stored |
| Property has no available executive | Lead saved as `PENDING_ASSIGNMENT` with a `notice` |
| Manager assigns outside their teams | `403` |
| Executive asks for a lead they no longer have (reassigned) | `404` |
| Executive only opens the lead | SLA keeps running |
| Status leaves `INCOMING` | SLA stops |
| Lead is `INCOMING` for 90 minutes (24/7) | Moves to the next executive, history `TIMEOUT` |
