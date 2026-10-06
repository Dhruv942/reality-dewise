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
#   set SEED_ADMIN_PASSWORD and SEED_EXECUTIVE_PASSWORD (min 8 chars)

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
| `npm run seed` / `npm run seed:prod` | Create/update the admin and a sample executive (`seed:prod` runs the compiled `dist` version) |
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
| `JWT_EXPIRES_IN` | no | `1h` | No refresh tokens: users log in again when it expires |
| `DB_POOL_MAX` | no | `10` | |
| `CORS_ORIGINS` | no | empty | Comma-separated frontend origins. Empty = same-origin only |
| `TRUST_PROXY` | no | unset | Number of proxies in front of the app (1 on most PaaS) so rate limiting sees the real IP |
| `LEAD_TIMEOUT_JOB_ENABLED` | no | `true` | Runs the lead timeout sweep inside the API process (`false` to run it elsewhere) |
| `LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS` | no | `60` | How often the sweep looks for timed-out leads (min 5). The SLA duration itself is an admin setting (default 90 minutes, runs 24/7) |
| `LOGIN_RATE_LIMIT_MAX` / `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | no | `10` / `15` | Failed-login limiter |
| `SEED_*` | for `seed` | | Admin and sample executive email, username, name, password. **No default passwords exist** |

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
│       ├── teams/                # teams CRUD (group sales users; each team can have a manager)
│       ├── executives/           # account management shared by sales users and managers (one service, two roles)
│       ├── managers/             # /admin/managers routes (reuse the executives service)
│       ├── properties/           # properties: list/edit, pick executives (created by leads)
│       ├── assignment/           # assignment engine (rules + strategies, round robin) + assignment history
│       ├── settings/             # admin-only system settings (the lead assignment rule)
│       ├── customers/            # clients: one per mobile number, with enquiry history
│       ├── leads/                # lead creation flow, status, executive "new lead" tracking
│       ├── admin/admin.routes.ts # mounts every admin module under /api/v1/admin (ADMIN only)
│       ├── manager-portal/       # /api/v1/manager: a manager's teams, executives and leads, lead assignment (MANAGER only)
│       └── executive-portal/     # /api/v1/executive: a sales user's own leads (SALES only)
├── migrations/                   # numbered SQL migrations (001 … 014)
├── seed/seed-users.ts            # creates the first admin / sample executive
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
Lead received (name, mobile, propertyName, source, requirement, budget …)
   │
   ├─ 1. Client:    find by mobile, or create. Never duplicated; the name is not used for matching
   ├─ 2. Property:  find by normalised name, or create ONE stub. Never one per lead
   ├─ 3. Lead:      saved with clientId + propertyId
   ├─ 4. Assign:    round-robin over the executives picked for that property (active ones only)
   │       ├─ someone available → status INCOMING, executive notified through the dashboard
   │       └─ nobody            → status PENDING_ASSIGNMENT + a notice; assigned automatically
   │                              as soon as an admin picks executives for the property,
   │                              or by hand: an admin or a manager assigns it to an executive
   ├─ 5. Executive opens the lead → current enquiry + the client's full history
   └─ 6. Still INCOMING after the SLA (90 min by default, 24/7, admin-set)? → reassigned to the next executive, repeating until someone handles it
```

- **Roles:** `ADMIN` (everything under `/admin`, creates every account), `MANAGER` (`/manager`: leads teams, assigns leads to the sales users of those teams) and `SALES` (`/executive`: works their own leads). A separate `designation` (`MANAGER`, `SALES_EXECUTIVE`, `EXECUTIVE_MANAGER`) labels users: **Sales Executive and Executive Manager are the same role with identical permissions**. Tokens are role-bound, users sign in with email or username, and changing a password invalidates older tokens.
- **Lead statuses:** `INCOMING → RINGING → CONNECTED → CLOSED / LOST / BROKER` (any order), plus the system status `PENDING_ASSIGNMENT`.
- **"New lead" for executives:** there is no push system yet. Each lead has `isNew` and `assignedAt`, and `/executive/leads/summary` gives the badge count. The frontend polls (see section 6 of `docs/FRONTEND_ROUND_ROBIN_GUIDE.md`).

## API overview

Base path `/api/v1`. All errors look like `{ "success": false, "message": "…", "errors"?: [{ "field", "message" }] }`.

| Area | Endpoints | Who |
|---|---|---|
| Auth | `POST /auth/admin/login`, `/auth/manager/login`, `/auth/executive/login`, `GET /auth/me` | public / any token |
| Teams | `/admin/teams` (list, create, get, update incl. `managerId`, status, members) | admin |
| Managers | `/admin/managers` (CRUD, status, password) | admin |
| Sales executives | `/admin/executives` (CRUD incl. `designation`, status, password, team) | admin |
| Properties | `/admin/properties` (list, get, edit, status, `PUT :id/executives`, assignment history) | admin |
| Clients | `/admin/customers` (list, get with all enquiries, edit) | admin |
| Leads | `/admin/leads` (create, list, get + client history, status, `:id/assign`) | admin |
| Settings | `GET` / `PUT` `/admin/settings/assignment-rule` (default `ROUND_ROBIN`) and `/admin/settings/lead-timeout` (SLA, default 90 minutes) | admin only |
| Manager portal | `/manager/teams`, `/manager/executives`, `/manager/leads` (list, get, `:id/assign`) | manager |
| Executive portal | `/executive/leads` (list, `summary`, get, status) | sales executive / executive manager |
| Important leads | `POST` / `DELETE` `…/leads/:id/important` in each portal; `isImportant` on every lead, `?important=true` filter | admin, manager, sales |
| Health | `GET /health` | public |

Request/response details for the assignment APIs (round robin, settings, SLA, manual assignment): [`docs/FRONTEND_ROUND_ROBIN_GUIDE.md`](docs/FRONTEND_ROUND_ROBIN_GUIDE.md).

## Testing

```bash
cp .env.test.example .env.test     # point DATABASE_URL at a THROWAWAY database
createdb realestate_crm_test
npm run migrate:test
npm test
```

The tests start the real app on a random port and call it over HTTP against real Postgres, including concurrency cases (parallel leads, duplicate webhooks, round-robin fairness). **Each run truncates `users`, `teams`, `customers` and `properties` in the test database**, so never aim `.env.test` at real data.

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
