# Zoho Mail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a backend-only, admin-connected Zoho Mail integration that sends durable, retryable assignment emails to executives without changing CRM authentication or lead assignment behavior.

**Architecture:** Use the existing Express modules, PostgreSQL migrations, JWT/RBAC middleware and interval-job pattern. OAuth state and connection data are stored in PostgreSQL; refresh tokens and cached access tokens are AES-256-GCM encrypted with an environment secret. Lead assignment remains the source of truth and, after commit, enqueues a deduplicated email outbox row. A worker claims rows with PostgreSQL row locks, sends through Zoho Mail, and records retry/permanent failure state.

**Tech Stack:** Node 22, TypeScript, Express 5, PostgreSQL/pg, node-pg-migrate SQL migrations, Zod, built-in `fetch` and `crypto`; no new runtime dependency.

**Spec:** User-provided “Implement Complete Zoho Mail Integration in Realty Adwise CRM” request.

## Global Constraints

- Backend only; do not modify the frontend.
- Do not change CRM login, lead assignment, round-robin, webhook, comments or history behavior.
- Use `ZohoMail.accounts.READ` and `ZohoMail.messages.CREATE`.
- Never return or log OAuth codes, access tokens or refresh tokens.
- OAuth callback remains `/api/v1/auth/zoho/callback`.
- Zoho regional Accounts and Mail base URLs remain environment-configured.
- Lead assignment must succeed even when email delivery fails.
- Teams remain removed; no team-based functionality is introduced.

## Review Focus

- OAuth state is one-time, expiring and admin-bound: callback tests cover valid, missing, expired and replayed state.
- Refresh-token encryption is non-reversible without the configured key: service tests cover round-trip and malformed ciphertext rejection.
- Assignment notification is committed after assignment and deduplicated by assignment event: workflow tests cover retries and unchanged assignment.
- Worker retries only transient/provider-rate-limit failures and marks invalid authorization for reconnect: worker tests cover both classes.
- Zoho response payloads are provider-shaped and may omit fields: account parsing and send-response tests cover malformed/error payloads.

---

### Task 1: Configuration and database schema

**Files:**
- Modify: `src/config/env.ts`, `.env.example`
- Create: `migrations/032_zoho_mail_integration.sql`

- [ ] Add optional Zoho configuration fields and fail clearly at runtime when an integration operation is attempted without complete configuration.
- [ ] Add tables for OAuth state, one organization-level Zoho connection, and email notification outbox/logs with unique assignment-event dedupe, claim/retry columns, indexes and encrypted-token columns.
- [ ] Verify migration up/down on the test database.

### Task 2: OAuth and Zoho API services

**Files:**
- Create: `src/modules/zoho/zoho.crypto.ts`, `zoho.repository.ts`, `zoho.service.ts`, `zoho.types.ts`
- Modify: `src/modules/auth/auth.routes.ts`

- [ ] Implement admin-bound state creation/consumption using a SHA-256 state hash, 10-minute expiry and one-time `used_at` update inside a transaction.
- [ ] Implement authorization URL generation, authorization-code exchange, account retrieval and encrypted token refresh with a per-process refresh lock.
- [ ] Implement Zoho account parsing and send-mail calls using configured regional URLs and sanitized provider errors.
- [ ] Implement callback success/failure redirects to `FRONTEND_URL` without secrets.

### Task 3: Integration management APIs

**Files:**
- Create: `src/modules/zoho/zoho.routes.ts`, `zoho.controller.ts`, `zoho.validation.ts`
- Modify: `src/app.ts`

- [ ] Add authenticated Admin-only connect route under `/api/v1/auth/zoho/connect`.
- [ ] Add Admin-only status, disconnect and test-email routes under `/api/v1/integrations/zoho`.
- [ ] Ensure status exposes only connection state, sender email, timestamps and safe error summary.

### Task 4: Assignment outbox and worker

**Files:**
- Create: `src/modules/email-notifications/email-notification.repository.ts`, `email-notification.service.ts`, `email-notification.worker.ts`, `email-notification.template.ts`
- Modify: `src/modules/leads/lead.events.ts`, `src/server.ts`

- [ ] Enqueue one row after each committed assignment event when a valid active executive email exists.
- [ ] Use the existing assignment event key (`lead + executive + assigned_at`) for idempotency.
- [ ] Claim rows with `FOR UPDATE SKIP LOCKED`, send asynchronously, record provider message IDs, retry transient failures with bounded exponential backoff and mark authorization failures as reauthorization-required.
- [ ] Keep assignment request/event publication successful even if queue insertion or delivery fails.

### Task 5: Tests and documentation

**Files:**
- Create: `tests/zoho-mail.test.ts`, `tests/email-notification.test.ts`
- Modify: `README.md`, `docs/ZOHO_OAUTH_CALLBACK.md`

- [ ] Test OAuth state, authorization, callback, encryption, account parsing, token refresh, disconnect and permission boundaries.
- [ ] Test outbox dedupe, assignment integration, retry classification and sanitized HTML/plaintext templates with mocked Zoho HTTP.
- [ ] Run focused tests, typecheck, build and full suite; report unrelated existing failures separately.

