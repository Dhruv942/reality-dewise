# Production Priority 1 Stabilization Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize the database-backed test and deployment baseline before adding further production scaling changes.

**Architecture:** Preserve the existing PostgreSQL, Express and SQL migration architecture. Fix transaction/pool usage first, then align regression tests with already-approved CRM behavior, and verify the full suite against the local test database.

**Tech Stack:** Node 22, TypeScript, Express 5, PostgreSQL, `pg`, `node-pg-migrate`, `node:test`.

## Scope

- Fix connection-pool exhaustion caused by a transaction-aware property lookup bypassing its transaction client.
- Update tests only where the current validation and customer-history behavior is intentional and already implemented.
- Keep webhook, Zoho, assignment, lead history and team-removal architecture unchanged.
- Do not weaken production validation or authorization merely to make tests pass.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm test` with local PostgreSQL available

## Known Review Points

- Concurrent lead creation must not exhaust the pool or create duplicate stub properties.
- Lost/invalid status changes must continue requiring their configured reason.
- Historical lead visibility must remain consistent with the customer-history requirement.
- Notification and assignment foreign keys must preserve lead history and prevent destructive deletion.
