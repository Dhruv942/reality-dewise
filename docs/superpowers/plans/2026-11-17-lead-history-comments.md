# Lead History and Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let current and previously assigned executives, relevant managers, and admins read a lead's complete history and add role-authorized comments.

**Architecture:** Reuse `lead_activities` as the chronological history store by adding a `COMMENT_ADDED` activity type. Add a role-scoped comment endpoint and allow an executive to read a lead when they appear in its assignment history, while keeping status/follow-up mutation permissions limited to the current owner, manager scope, or admin.

**Tech Stack:** TypeScript, Express 5, PostgreSQL migrations, Node test runner, tsx.

**Spec:** User requirement that executives can enter comments and see previous comments/history from prior executives, managers, and admins, tied to lead history.

## Global Constraints

- Do not add or restore teams; existing direct `users.manager_id` scope remains authoritative.
- Preserve existing admin/manager/current-executive mutation permissions.
- Comments are plain text, trimmed, and limited to 2000 characters.
- History is append-only and returns actor, timestamp, activity type, executive, and message.

## Review Focus

- Comment text validation and actor attribution — history integration tests.
- Previous executive can read historical lead activity but cannot update current lead status — access tests.
- Current executive, manager, and admin can add comments only to leads they can access — role tests.
- Existing activity entries and customer history remain unchanged — regression tests.
- Migration is additive and safe for existing rows — migration/typecheck verification.

### Task 1: Add failing history/comment tests

**Files:**
- Create: `tests/lead-history.test.ts`

- [ ] **Step 1: Write tests** for admin/current executive comment creation, comment appearing in lead detail activity, previous executive read access after transfer, previous executive mutation rejection, manager access, invalid/oversized comments, and customer history preservation.
- [ ] **Step 2: Run the focused test and verify it fails because `COMMENT_ADDED` and the comment route/access behavior are missing.**

### Task 2: Add the comment activity type and service behavior

**Files:**
- Create: `migrations/025_lead_comment_activity.sql`
- Modify: `src/modules/leads/lead-activity.repository.ts`
- Modify: `src/modules/leads/lead-activity.service.ts`
- Modify: `src/modules/leads/lead.service.ts`
- Modify: `src/modules/leads/lead.repository.ts`

- [ ] **Step 1: Add the additive migration** for `COMMENT_ADDED`.
- [ ] **Step 2: Add comment validation and append-only activity recording** inside a transaction with actor and current executive metadata.
- [ ] **Step 3: Add historical assignment lookup** and use it only for executive read access; do not broaden status, follow-up, important, assignment, or transfer mutations.
- [ ] **Step 4: Run focused tests and verify they pass.**

### Task 3: Expose comments through all role portals

**Files:**
- Modify: `src/modules/leads/lead.validation.ts`
- Modify: `src/modules/leads/lead.controller.ts`
- Modify: `src/modules/leads/lead.routes.ts`

- [ ] **Step 1: Add `POST /admin/leads/:id/comments`, `POST /manager/leads/:id/comments`, and `POST /executive/leads/:id/comments`.**
- [ ] **Step 2: Enforce each portal's existing access scope and return the refreshed lead detail with activity history.**
- [ ] **Step 3: Run focused tests and verify they pass.**

### Task 4: Verify the complete change

- [ ] **Step 1: Run `npm run typecheck`.**
- [ ] **Step 2: Run focused history/webhook/lead regression tests.**
- [ ] **Step 3: Run `git diff --check` and review the working-tree diff without changing unrelated user edits.**
