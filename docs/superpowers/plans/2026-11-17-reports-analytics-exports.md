# Reports, Analytics & Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add backend reports, analytics and filtered CSV/Excel-compatible exports over the existing CRM source tables.

**Architecture:** Add a report module with one validated filter model, a parameterized SQL repository that joins leads to properties, projects and current executive-manager relationships, and a service that applies role scope before aggregating. Reports use current lead state plus persisted assignment history; no reporting copy tables or team concepts are introduced.

**Tech Stack:** TypeScript, Express 5, Zod, PostgreSQL/`pg`, existing auth middleware, Node test runner.

**Spec:** User-provided Implementation Prompt: Reports, Analytics & Exports — RealtyAdwise CRM.

## Global Constraints

- Reuse existing source tables and assignment/history models; do not create a duplicate analytics database.
- Do not introduce teams, roles, a new assignment engine, portal integrations, bulk reassignment or a frontend.
- Use inclusive `fromDate` and exclusive next-day `toDate` boundaries in the requested timezone, default `UTC`.
- Managers are scoped to their direct-report executives; sales users are scoped to themselves; scope is enforced in SQL/service code.
- Current sources are the canonical `99ACRES` and `MAGICBRICKS` values; unsupported manual sources are not fabricated.
- Current status and follow-up data are reported as current/scheduled facts; historical status snapshots and follow-up completion events are documented as unavailable.
- Price-band grouping reuses `src/modules/catalog/catalog.policy.ts` and the persisted property/inventory `price_band` values.

## Review Focus

- Invalid date ranges/timezones and unsupported query parameters → filter validation tests in Task 1.
- Manager/executive query-parameter escalation → scoped report tests in Task 4.
- Missing project/property/price/source values → aggregation tests in Task 3.
- Current ownership versus historical assignment → executive report tests in Task 3.
- CSV formula injection and empty/large exports → export tests in Task 5.

### Task 1: Shared report filters and pure export policies

**Files:**
- Create: `src/modules/reports/report.model.ts`
- Create: `src/modules/reports/report.validation.ts`
- Create: `src/modules/reports/export.policy.ts`
- Test: `tests/report-policy.test.ts`

**Interfaces:**
- `ReportFilters`: optional from/to date, manager, executive, source, status, project/property, transaction/property type, location, min/max price, price band, timezone, limit/offset, format.
- `parseReportFilters(query)`: validates strict query keys, date range, non-negative prices, canonical enums and timezone.
- `safeSpreadsheetCell(value)`, `csvEscape(rows)`, `excelCompatibleTsv(rows)`: deterministic safe serializers.

- [ ] Write failing tests for date boundaries, invalid ranges, unsupported keys, formula-prefix escaping, empty rows and canonical price-band labels.
- [ ] Run `node --import tsx --test tests/report-policy.test.ts` and confirm expected red failures.
- [ ] Implement the filter schema/policies without database access.
- [ ] Rerun the policy test and confirm green.

### Task 2: Reporting SQL repository and indexes

**Files:**
- Create: `src/modules/reports/report.repository.ts`
- Create: `migrations/030_reports_indexes.sql`
- Test: `tests/report-repository.test.ts`

**Interfaces:**
- `listLeadReportRows(filters, scope)`: paginated, non-sensitive lead report rows.
- `countLeadSummary(filters, scope)`: total/new/assigned/unassigned aggregates.
- `groupLeadReport(filters, scope, dimension)`: database-level breakdown rows.
- `executiveMetrics(filters, scope)`, `managerMetrics(filters, scope)`, `followUpMetrics(filters, scope)`.

- [ ] Add database-backed tests with leads covering missing project, price and assignment values, combined filters, date inclusivity and current versus historical assignment.
- [ ] Run the repository tests red before implementation.
- [ ] Implement one parameterized base predicate builder; scope predicates must be separate from user filters and use direct manager/executive relationships.
- [ ] Add only justified indexes for lead created/source/status, current assignment, property dimensions, follow-up date and assignment-history date/executive/method.
- [ ] Run migration and repository tests green.

### Task 3: Report service and response contracts

**Files:**
- Create: `src/modules/reports/report.service.ts`
- Create: `src/modules/reports/report.model.ts` additions as needed
- Test: `tests/reports.test.ts`

**Interfaces:**
- `getOverview(filters, scope)` with summary and breakdowns by status/source/executive/manager/project/property/transaction/property type/location/price band.
- `getLeadReport(filters, scope)` with paginated rows and summary.
- `getExecutiveReport(filters, scope)`: current ownership, assignments during period, reassignment events and status/source/follow-up summaries.
- `getManagerReport(filters, scope)`: active direct reports, current lead counts and executive breakdown.
- `getSourceReport`, `getPropertyReport`, `getTransactionReport`, `getFollowUpReport`.

- [ ] Write failing integration tests for every report family, combined filters, distinct lead counts, missing values and no-result reports.
- [ ] Implement service orchestration using repository aggregates; return `data` plus `meta.appliedFilters`, timezone and generated timestamp.
- [ ] Mark unsupported metrics explicitly (`follow-up completed` and conversion rate unavailable without event data) rather than deriving them from status.
- [ ] Run focused reports tests green.

### Task 4: Authenticated report routes and role scope

**Files:**
- Create: `src/modules/reports/report.controller.ts`
- Create: `src/modules/reports/report.routes.ts`
- Modify: `src/modules/admin/admin.routes.ts`
- Modify: `src/modules/manager-portal/portal.routes.ts`
- Modify: `src/modules/executive-portal/portal.routes.ts`
- Test: `tests/report-authorization.test.ts`

**Interfaces:**
- `GET /admin/reports/{overview,leads,executives,managers,sources,properties,transactions,follow-ups}`.
- Equivalent scoped `/manager/reports/*` and `/executive/reports/*` routes where the current role model permits report access.

- [ ] Write failing authorization tests for organization-wide Admin access, manager scope, executive self-scope, and query parameter escalation.
- [ ] Implement route mounting using existing authentication/role middleware and pass immutable scope from `req.user` to the service.
- [ ] Reject unsupported filters and prevent managers/executives from selecting another owner.
- [ ] Run authorization tests green.

### Task 5: CSV and Excel-compatible exports

**Files:**
- Modify: `src/modules/reports/report.controller.ts`
- Modify: `src/modules/reports/report.service.ts`
- Test: `tests/report-export.test.ts`

**Interfaces:**
- `?format=json|csv|excel` on report endpoints, or dedicated `/export` suffix if route conventions require it.
- CSV uses `text/csv`; Excel-compatible TSV uses `application/vnd.ms-excel` and a safe `.xls` filename. Both use the exact same filters and scope as JSON.

- [ ] Write failing tests for headers, filtered row parity, empty exports, formula injection and authorization.
- [ ] Implement bounded/stream-friendly row retrieval and safe serialization without customer mobile/email fields.
- [ ] Run export tests green.

### Task 6: Documentation and verification

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] Document endpoints, filter names, UTC/default timezone, metric definitions, source limitations, price-band policy, scope rules and export formats.
- [ ] Run `npm run migrate:test`, `npm run typecheck`, `npm run build`, focused report tests and the relevant webhook/property/lead regression tests.
- [ ] Run the full test command; record actual failures without claiming unrelated or database-concurrency failures as passing.
- [ ] Run `git diff --check` and review the final diff.
