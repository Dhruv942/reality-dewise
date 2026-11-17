# Real Estate CRM: Backend

REST API for a real-estate lead desk. Enquiries from portals (99acres, Magicbricks) become **leads** linked to a **client** (by mobile number) and a **property** (by name). Each lead is assigned to a **sales executive** by round-robin over the executives picked for that property, and admins and **managers** can assign or reassign leads by hand. Users have one of three roles (admin, manager, sales); admins create and manage all accounts.

**Stack:** Node 22 · TypeScript · Express 5 · PostgreSQL · `pg` · `node-pg-migrate` (SQL migrations) · Zod · JWT (`jsonwebtoken`) · argon2 · helmet / cors / express-rate-limit · `node:test` for tests.

## Contents
1. [Quick start](#quick-start)
2. [Scripts](#scripts)
3. [Environment variables](#environment-variables)
4. [Project structure](#project-structure)
5. [How the system works](#how-the-system-works)
6. [API overview](#api-overview)
7. [Testing](#testing)
8. [Deployment](#deployment)
9. [Troubleshooting](#troubleshooting)

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (design, database, rules) and [`docs/FRONTEND_ROUND_ROBIN_GUIDE.md`](docs/FRONTEND_ROUND_ROBIN_GUIDE.md) (frontend guide: round robin lead assignment, the admin-only rule and 90-minute SLA settings, manual assignment, and every API involved, per role).

---

## Quick start

**Prerequisites:** Node.js ≥ 22.9 (`nvm use` reads `.nvmrc`) and PostgreSQL 14+.

```bash
# 1. install
npm install

# 2. create a database
createdb realestate_crm

# 3. configure
cp .env.example .env
#   set DATABASE_URL (e.g. postgres://you@localhost:5432/realestate_crm)
#   set JWT_SECRET   (openssl rand -hex 48)
#   set SEED_ADMIN_PASSWORD and SEED_EXECUTIVE_PASSWORD (min 8 chars); optionally SEED_MANAGER_PASSWORD,
#   SEED_EXECUTIVE_2_PASSWORD and SEED_EXECUTIVE_3_PASSWORD to also create a manager and two more executives

# 4. create the tables
npm run migrate:up

# 5. create the first admin (+ a sample executive)
npm run seed

# 6. run with auto-reload
npm run dev          # http://localhost:4000
```

Check it works: `curl http://localhost:4000/health` → `{"status":"ok","db":"up"}`.

**Try the API in a browser:** with `NODE_ENV=development`, open <http://localhost:4000/test-console>. It is a small form-based page (dev only, disabled in production) that lists every endpoint: log in as admin first, then work through the sections top to bottom.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload (`tsx watch`), loads `.env` |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled server (`dist/src/server.js`) |
| `npm run typecheck` | Type-check `src`, `seed` and `tests` without emitting |
| `npm run migrate:up` | Apply pending migrations to the `.env` database |
| `npm run migrate:down` | Revert the last migration (see warning below) |
| `npm run migrate:test` | Apply migrations to the **test** database (`.env.test`) |
| `npm run seed` / `npm run seed:prod` | Create/update the admin, an optional manager and up to 3 executives, with the executives reporting to the manager. Re-running resets those accounts' passwords and reactivates them, so use different `SEED_*_EMAIL` values to add accounts without touching existing ones (`seed:prod` runs the compiled `dist` version) |
| `npm test` | Run the whole test suite against the test database |

> Migrations `007`, `009` and `010` rewrite or drop columns/types and cannot be fully reversed. Back up before running migrations on a database you care about.

## Environment variables

Validated at startup by `src/config/env.ts` (the server refuses to start on bad config). Template: `.env.example`.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | | Postgres URL. Managed databases: append `?sslmode=require` |
| `JWT_SECRET` | yes | | ≥ 32 chars. `openssl rand -hex 48` |
| `NODE_ENV` | no | `production` | `development` enables `/test-console` |
| `PORT` | no | `4000` | |
| `JWT_EXPIRES_IN` | no | `1h` | Lifetime of the access token; the portal renews it with a refresh token (see `REFRESH_EXPIRES_IN`) |
| `REFRESH_EXPIRES_IN` | | `30d` | How long a login can be renewed without the password (`POST /auth/refresh`), counted from the login and never extended. Deactivating the account or changing its password ends it. |
| `DB_POOL_MAX` | no | `10` | |
| `CORS_ORIGINS` | no | empty | Comma-separated frontend origins. Empty = same-origin only |
| `TRUST_PROXY` | no | unset | Number of proxies in front of the app (1 on most PaaS) so rate limiting sees the real IP |
| `LEAD_TIMEOUT_JOB_ENABLED` | no | `true` | Runs the lead timeout sweep inside the API process (`false` to run it elsewhere) |
| `LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS` | no | `60` | How often the sweep looks for timed-out leads (min 5). The SLA duration itself is an admin setting (default 90 minutes, runs 24/7) |
| `SOCKET_CORS_ORIGIN` | no | `CORS_ORIGINS` | Comma-separated origins allowed to open a Socket.IO connection. Empty and no `CORS_ORIGINS` = same-origin only |
| `SLA_WARNING_MINUTES` | no | `10` | How long before the SLA runs out the executive gets `lead:sla-warning` (capped at half the SLA; `0` disables it) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | no | unset | Web Push for closed-app notifications. Set all three or none. Generate: `npx web-push generate-vapid-keys`; subject like `mailto:ops@example.com` |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | no | `10` / `15` | Failed-login limiter |
| `SEED_*` | for `seed` | | Email, username, name and password for the admin, the manager (`SEED_MANAGER_*`), executive 1 (`SEED_EXECUTIVE_*`) and executives 2-3 (`SEED_EXECUTIVE_2_*`, `SEED_EXECUTIVE_3_*`). **No default passwords exist**; an empty optional password skips that account |

`.env` and `.env.test` are git-ignored. Never commit them.

## Project structure

```
.
├── src/
│   ├── server.ts                 # starts the HTTP server, graceful shutdown
│   ├── app.ts                    # builds the Express app: middleware, routes, /health, error handlers
│   ├── config/env.ts             # typed, validated environment
│   ├── database/
│   │   ├── pool.ts               # shared pg pool
│   │   ├── transaction.ts        # withTransaction() + the Db type (pool or transaction client)
│   │   └── patch.ts              # small helper for partial UPDATEs
│   ├── middleware/               # errorHandler (maps errors/DB constraints to JSON), validate (Zod), rateLimit
│   ├── utils/                    # errors, jwt, password (argon2), mobile normalisation, validate
│   └── modules/                  # one folder per feature (see "Module layout")
│       ├── auth/                 # admin & executive login, /auth/me, JWT middleware, role guard
│       ├── users/                # shared user table access
│       ├── executives/           # account management shared by sales users and managers (one service, two roles)
│       ├── managers/             # /admin/managers routes (reuse the executives service)
│       ├── properties/           # properties: structured fields, list/edit, pick executives (created by leads)
│       ├── property-mappings/    # portal listing IDs and verified aliases → internal properties
│       ├── property-matching/    # exact-ID, alias, normalized-name and conservative fuzzy matching
│       ├── projects/             # Admin project master data and archival
│       ├── inventory/            # Admin inventory/unit master data and lifecycle
│       ├── assignment/           # assignment engine (rules + strategies, round robin) + assignment history
│       ├── settings/             # admin-only system settings (assignment, SLA and unmatched-property routing)
│       ├── reports/               # scoped lead analytics and CSV/Excel-compatible exports
│       ├── customers/            # clients: one per mobile number, with enquiry history
│       ├── leads/                # lead creation flow, status, executive "new lead" tracking
│       ├── admin/admin.routes.ts # mounts every admin module under /api/v1/admin (ADMIN only)
│       ├── manager-portal/       # /api/v1/manager: a manager's executives, leads, lead assignment and property executive lists (MANAGER only)
│       └── executive-portal/     # /api/v1/executive: a sales user's own leads (SALES only)
   ├── migrations/                   # numbered SQL migrations (001 … 030)
├── seed/seed-users.ts            # creates the first admin, an optional manager and up to 3 executives (the executives report to the manager)
├── tests/                        # integration tests (real HTTP + real Postgres)
├── public/test-console.html      # dev-only manual API tester
├── docs/                         # ARCHITECTURE.md (design) · FRONTEND_ROUND_ROBIN_GUIDE.md (frontend guide for round robin assignment)
├── .env.example  .env.test.example  .nvmrc
├── tsconfig.json  tsconfig.build.json
└── package.json
```

### Module layout

Every feature module follows the same layers. Code only calls downward:

```
<name>.routes.ts       URL + HTTP method → controller, attaches Zod validation
<name>.controller.ts   reads the request, calls the service, writes the response (no business logic)
<name>.service.ts      business rules, transactions, errors (AppError / NotFoundError)
<name>.repository.ts   all SQL for the feature
<name>.model.ts        DB row types + toXxxDto() (DB shape → API shape)
<name>.validation.ts   Zod schemas for bodies and query strings
```

To add a feature: create the folder with these files, then mount its router in `admin.routes.ts` (admin) or `portal.routes.ts` (executive). To change the database: add `migrations/010_<what>.sql` with `-- Up Migration` and `-- Down Migration` sections, run `npm run migrate:up` and `npm run migrate:test`, and keep the tests green.

## How the system works

```
Lead received (name, mobile, propertyName, source, portal property ID/name, requirement, budget …)
   │
   ├─ 1. Client:    find by mobile, or create. Never duplicated; the name is not used for matching
   ├─ 2. Property:  exact portal ID → registered portal alias → normalized name → conservative fuzzy candidate
   │       ├─ reliable match → existing property and its executive round robin
   │       └─ no/ambiguous match → one unresolved stub, durable review queue, no automatic assignment
   ├─ 3. Lead:      saved with clientId + propertyId
   ├─ 4. Assign:    round-robin over the executives picked for that property (active ones only)
   │       ├─ someone available → status INCOMING, executive notified through the dashboard
   │       └─ nobody            → status PENDING_ASSIGNMENT + a notice; assigned automatically
   │                              as soon as an admin picks executives for the property,
   │                              or by hand: an admin or a manager assigns it to an executive
   ├─ 5. Executive opens the lead → current enquiry + the client's full history
   └─ 6. Still INCOMING after the SLA (90 min by default, 24/7, admin-set)? → reassigned to the next executive, repeating until someone handles it
```

### Portal matching and unresolved-property review

`portal_property_mappings` keeps an external listing identity separate from the internal property ID. One property may have mappings for both 99acres and Magicbricks. Active `(portal, externalPropertyId)` and `(portal, normalized alias)` values are unique. Matching always prefers an exact external ID, then a registered alias/name, then an exact normalized property name; fuzzy matching is only accepted when one candidate clears the central threshold and margin. Ambiguous candidates are never auto-assigned.

Unmatched leads remain `PENDING_ASSIGNMENT` and are listed at `GET /api/v1/admin/leads/unmatched-properties`. Admins can inspect candidates with `GET /api/v1/admin/leads/:id/property-match-candidates`, resolve to an existing property with `POST /api/v1/admin/leads/:id/resolve-property`, or resolve and register the portal mapping with `POST /api/v1/admin/leads/:id/register-property-mapping` and `{ "propertyId": "..." }`. Resolution preserves the lead/activity history and invokes the existing property round robin once. Repeated portal deliveries reuse the same placeholder mapping when an external property ID is available.

The fallback setting accepts `{ "mode": "ADMIN_QUEUE" }` or `{ "mode": "DESIGNATED_MANAGER", "managerId": "..." }` at `PUT /api/v1/admin/settings/unmatched-property-routing`. Admin queue is the safe default; a designated manager must be active. Teams are not used.

### Reports, analytics and exports

Report endpoints accept the shared optional filters `fromDate`, `toDate`, `managerId`, `executiveId`, `source`, `status`, `projectId`, `propertyId`, `transactionType`, `propertyCategory`, `location`, `minPrice`, `maxPrice`, `priceBand`, `tz`, `limit` and `offset`. Dates are inclusive by calendar day and converted using `tz` (default `UTC`); the database query uses an exclusive next-day boundary. Unknown query parameters, invalid ranges, negative prices and invalid timezones are rejected.

`overview` returns summary cards and breakdowns by status, source, executive, manager, project, property, transaction type, property category, location and price band. `leads` returns paginated business rows without customer phone/email. `executives` separates current ownership from assignment events during the period and counts transfers/timeouts. `managers`, `sources`, `properties`, `transactions` and `follow-ups` provide their respective aggregates. Property lead counts are distinct lead counts and are not multiplied by inventory units.

Use `format=csv` or `format=excel` on any report endpoint to download the same filtered lead dataset. CSV is `text/csv`; Excel is an Excel-compatible tab-separated `.xls` download. Spreadsheet formula prefixes are escaped. The current schema stores only the next follow-up, so completed follow-ups and conversion rates are not fabricated; the follow-up report explicitly reports that completion history is unavailable. Current lead sources are `99ACRES` and `MAGICBRICKS`; unsupported manual source categories are not invented.

- **Roles:** `ADMIN` (everything under `/admin`, creates every account), `MANAGER` (`/manager`: looks after the sales users whose `managerId` is them, assigns leads and properties to them) and `SALES` (`/executive`: works their own leads). A separate `designation` (`MANAGER`, `SALES_EXECUTIVE`, `EXECUTIVE_MANAGER`) labels users: **Sales Executive and Executive Manager are the same role with identical permissions**. Tokens are role-bound, users sign in with email or username, and changing a password invalidates older tokens.
- **Lead statuses:** `INCOMING → RINGING → CONNECTED → CLOSED / LOST / BROKER` (any order), plus the system status `PENDING_ASSIGNMENT`.
- **"New lead" for executives:** there is no push system yet. Each lead has `isNew` and `assignedAt`, and `/executive/leads/summary` gives the badge count. The frontend polls (see section 6 of `docs/FRONTEND_ROUND_ROBIN_GUIDE.md`).

## API overview

Base path `/api/v1`. All errors look like `{ "success": false, "message": "…", "errors"?: [{ "field", "message" }] }`.

| Area | Endpoints | Who |
|---|---|---|
| Auth | `POST /auth/admin/login`, `/auth/manager/login`, `/auth/executive/login`, `GET /auth/me` | public / any token |
| Managers | `/admin/managers` (CRUD, status, password) | admin |
| Sales executives | `/admin/executives` (CRUD incl. `designation`, `managerId`, status, password; `PATCH/DELETE /:id/manager` sets or clears the manager) | admin |
| Properties | `/admin/properties` (list, get, edit, status, `PUT :id/executives`, assignment history) | admin |
| Projects | `/admin/projects` (list/search, create, get with related properties, edit, archive) | admin |
| Inventory | `/admin/inventory` (list/filter, create, get, edit, archive, status) | admin |
| Portal mappings | `/admin/property-mappings` (list, create, view, update, deactivate), `/admin/properties/:id/mappings` | admin |
| Clients | `/admin/customers` (list, get with all enquiries, edit) | admin |
| Leads | `/admin/leads` (create, list, get + client history/activity, `:id/comments`, status, `:id/assign`) | admin |
| Settings | `GET` / `PUT` `/admin/settings/assignment-rule` (default `ROUND_ROBIN`), `/admin/settings/lead-timeout` (SLA, default 90 minutes), `/admin/settings/unmatched-property-routing` | admin only |
| Reports | `/admin/reports/{overview,leads,executives,managers,sources,properties,transactions,follow-ups}`; scoped equivalents under `/manager/reports` and `/executive/reports` | admin / manager / sales |
| Manager portal | `/manager/executives` (list, get), `/manager/leads` (list, get, `:id/comments`, `:id/assign`), `/manager/properties` (list, get, `PUT :id/executives`: only their own executives' part of the list) | manager |
| Executive portal | `/executive/leads` (list, `summary`, get, `:id/comments`, status) | sales executive / executive manager; previously assigned executives can read historical lead activity |
| Important leads | `POST` / `DELETE` `…/leads/:id/important` in each portal; `isImportant` on every lead, `?important=true` filter | admin, manager, sales |
| Personal notes | `GET` / `POST /notes`, `GET` / `PATCH` / `DELETE /notes/:id` (`?search`, `limit`, `offset`) | any logged-in user (own notes only) |
| Notifications | `GET /notifications` (`?unread=true`, `limit`, `offset`; includes `unreadCount`), `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` | any logged-in user (own notifications only) |
| Web Push | `GET /push/public-key`, `POST /push/subscriptions`, `DELETE /push/subscriptions` (own devices only). See `docs/FRONTEND_PUSH_GUIDE.md` | any logged-in user |
| Health | `GET /health` | public |

### Project and inventory examples

Create a project:

```http
POST /api/v1/admin/projects
Content-Type: application/json

{"name":"Rustomjee Elita","location":"Thane","description":"Residential development"}
```

The response includes a server-generated code such as `PRJ-2026-000001`. Link an existing property with structured attributes through the existing property update endpoint:

```http
PATCH /api/v1/admin/properties/{propertyId}
Content-Type: application/json

{"projectId":"{projectId}","transactionType":"SALE_PURCHASE","propertyType":"RESIDENTIAL","minPrice":15000000,"maxPrice":18000000}
```

Create a unit:

```http
POST /api/v1/admin/inventory
Content-Type: application/json

{"propertyId":"{propertyId}","name":"Flat 1204","minPrice":15000000,"maxPrice":18000000,"availableFrom":"2026-12-01"}
```

Inventory returns a ten-digit server-generated `inventoryCode`, for example `2600000001`. Inventory uses the parent property's executive pool; creating or editing inventory never resets lead round-robin state. Inventory status values are `AVAILABLE`, `RESERVED`, `SOLD`, `RENTED`, `EXPIRED` and `INACTIVE`. Bulk reassignment, configurable statuses, advanced report exports beyond the documented CSV/Excel-compatible formats, teams and a frontend remain intentionally deferred.

### Real-time (Socket.IO)

Socket.IO runs on the same HTTP server (path `/socket.io`) as an extra delivery channel; REST and PostgreSQL stay the source of truth. Connect with the same access token as the REST API: `io(url, { auth: { token } })` (or an `Authorization: Bearer` header). The server puts the socket in its rooms (clients cannot join rooms): `user:<id>` for everyone, `admin`, `managers` + `manager:<id>`, `executive:<id>`. The connection closes when the token expires (`auth:expired`); reconnect with a fresh token and fetch anything missed from `GET /notifications`.

Events (sent only after the database change committed, only to people who may see the lead): `lead:created`, `lead:assigned`, `lead:reassigned`, `lead:status-updated`, `lead:sla-warning`, `lead:sla-expired`, and `notification:new` (the stored notification, to its owner). A previous executive receives `lead:reassigned` / `lead:sla-expired` without customer details.

Request/response details for the assignment APIs (round robin, settings, SLA, manual assignment): [`docs/FRONTEND_ROUND_ROBIN_GUIDE.md`](docs/FRONTEND_ROUND_ROBIN_GUIDE.md).

## Testing

```bash
cp .env.test.example .env.test     # point DATABASE_URL at a THROWAWAY database
createdb realestate_crm_test
npm run migrate:test
npm test
```

The tests start the real app on a random port and call it over HTTP against real Postgres, including concurrency cases (parallel leads, duplicate webhooks, round-robin fairness). **Each run truncates `users`, `customers` and `properties` in the test database**, so never aim `.env.test` at real data.

## Deployment

Any Node host with Postgres works (the API has been run on Render).

```bash
npm ci
npm run build
npm run migrate:up      # before starting the new version
npm start               # node dist/src/server.js
```

Set `NODE_ENV=production`, `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS` (your frontend URL) and `TRUST_PROXY=1` behind a proxy. Run `npm run seed:prod` once to create the first admin. `GET /health` is the health check. Free-tier hosts sleep when idle, so the first request can be slow.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Invalid environment configuration` on start | A required variable is missing or invalid; the message names the field |
| `relation "…" does not exist` / unknown column | Migrations not applied: `npm run migrate:up` |
| Browser shows a CORS error | Add the frontend origin to `CORS_ORIGINS` and restart |
| `429` on login | Rate limit (10 failed attempts per 15 min). Wait, or raise `LOGIN_RATE_LIMIT_MAX` locally |
| `401` after about an hour | The JWT expired. Log in again |
| Lead create returns `409 … inactive` | The property is inactive: reactivate it with `PATCH /admin/properties/:id/status` |
| Tests fail with `duplicate key` or missing tables | `.env.test` DB not migrated: `npm run migrate:test` |
