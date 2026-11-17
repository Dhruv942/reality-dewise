# Project & Inventory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Admin-managed projects and inventory units, extend existing properties with structured real-estate attributes, and preserve executive-first lead routing.

**Architecture:** Keep PostgreSQL/`pg`, SQL migrations, Express route/controller/service/repository modules, Zod validation, and existing transaction/error conventions. Add `projects` and `inventory` modules; extend `properties` in place; inventory inherits the parent property's executive pool and does not affect lead routing yet.

**Tech Stack:** Node 22, TypeScript, Express 5, PostgreSQL, `pg`, node-pg-migrate, Zod, node:test.

**Spec:** User-provided Project & Inventory Management task in the conversation.

## Global Constraints

- Do not reintroduce teams or team-based routing.
- Do not change existing lead intake, customer history, assignment, round-robin, comments, activity timelines, transfers, or webhooks.
- Only Admin may create/manage projects and inventory.
- Preserve standalone properties, portal-created stubs, existing IDs, and historical lead references.
- Use decimal-safe PostgreSQL money values; never use `MAX(id)+1` for codes.
- Deletion is not destructive where leads, properties, or inventory history would be affected; archive instead.

## Review Focus

- Concurrent inventory creation must produce unique non-reused codes: test parallel POSTs.
- Price ranges spanning bands must be classified consistently: test boundaries and missing prices.
- Archived parents must not silently accept active child records: test lifecycle validation.
- Existing property assignment and unknown-property webhook behavior must remain intact: run regression tests.
- Manager/executive access must remain denied for Admin-only master data: test role matrix.

### Task 1: Schema and shared domain policies

**Files:**
- Create: `migrations/026_projects_inventory.sql`
- Create: `src/modules/catalog/catalog.model.ts`
- Create: `src/modules/catalog/catalog.policy.ts`
- Test: `tests/catalog-policy.test.ts`

Implement projects, inventory, project linkage and structured property columns with indexes/constraints; create sequences for safe codes. Use `PRJ-YYYY-######` project codes and `YY########` ten-digit inventory codes. Centralize property/inventory enums and price-band classification. For price ranges, classify as `MIXED` when endpoints fall into different bands; missing prices return `UNKNOWN`.

### Task 2: Project Admin API

**Files:**
- Create: `src/modules/projects/project.model.ts`
- Create: `src/modules/projects/project.repository.ts`
- Create: `src/modules/projects/project.validation.ts`
- Create: `src/modules/projects/project.service.ts`
- Create: `src/modules/projects/project.controller.ts`
- Create: `src/modules/projects/project.routes.ts`
- Modify: `src/modules/admin/admin.routes.ts`
- Test: `tests/project.test.ts`

Add paginated/searchable Admin CRUD, project detail with related properties/counts, and safe archive. Reject new active children under archived projects and preserve existing children on archive.

### Task 3: Property extension and Admin API compatibility

**Files:**
- Modify: `src/modules/properties/property.model.ts`
- Modify: `src/modules/properties/property.repository.ts`
- Modify: `src/modules/properties/property.validation.ts`
- Modify: `src/modules/properties/property.service.ts`
- Modify: `src/modules/properties/property.controller.ts`
- Modify: `src/modules/properties/property.routes.ts`
- Test: `tests/property.test.ts`

Extend existing property list/detail/update/filter behavior with project, transaction type, property type, price range, currency, derived price band, inventory count and archive semantics. Keep automatic stub creation and existing executive assignment endpoints unchanged. Prevent destructive archive/delete behavior that would break leads; do not add a duplicate property-create flow.

### Task 4: Inventory Admin API and lifecycle

**Files:**
- Create: `src/modules/inventory/inventory.model.ts`
- Create: `src/modules/inventory/inventory.repository.ts`
- Create: `src/modules/inventory/inventory.validation.ts`
- Create: `src/modules/inventory/inventory.service.ts`
- Create: `src/modules/inventory/inventory.controller.ts`
- Create: `src/modules/inventory/inventory.routes.ts`
- Modify: `src/modules/admin/admin.routes.ts`
- Test: `tests/inventory.test.ts`

Add paginated/searchable/filterable Admin inventory CRUD, server-generated codes, parent/property/project consistency checks, archive, validated status transitions, and no second assignment system. Inventory edits must not alter property executives or round-robin state.

### Task 5: Regression coverage and documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/FRONTEND_ROUND_ROBIN_GUIDE.md` where API overview needs extension
- Test: existing suite plus new catalog/project/property/inventory tests

Document data relationships, code formats, price bands, lifecycle rules, Admin authorization, routes/examples, migration order, routing non-integration, and explicitly deferred portal mapping/routing/status/report/team/frontend work.

Verification: `npm run typecheck`, `npm run build`, focused catalog tests, then full `npm test`.
