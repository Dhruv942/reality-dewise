# Zoho Mail Backend Integration

The backend-only integration lets an authenticated CRM Admin connect one Zoho Mail sender. Lead assignment continues to use the existing CRM assignment and round-robin services. After a committed assignment, the backend creates one durable email job for the assigned executive; the worker sends it through Zoho and records success or failure.

## Redirect URI and routes

Register this exact URI in the Zoho API Console:

```text
https://reality-dewise.onrender.com/api/v1/auth/zoho/callback
```

Local development:

```text
http://localhost:4000/api/v1/auth/zoho/callback
```

Routes:

- `GET /api/v1/auth/zoho/connect` — Admin-only; creates a one-time 10-minute state and redirects to Zoho.
- `GET /api/v1/auth/zoho/callback` — public provider callback; state binds the callback to the initiating Admin, then the backend exchanges the code and verifies the mailbox.
- `GET /api/v1/integrations/zoho/status` — Admin-only safe connection status and recent delivery failures.
- `POST /api/v1/integrations/zoho/test-email` — Admin-only, body `{ "toAddress": "recipient@example.com" }`.
- `POST /api/v1/integrations/zoho/disconnect` — Admin-only; clears local usable credentials and marks the connection disconnected.
- `PATCH /api/v1/integrations/zoho/notifications` — Admin-only, body `{ "enabled": true|false }`.
- `POST /api/v1/integrations/zoho/notifications/:id/retry` — Admin-only controlled retry for a failed delivery.

The callback redirects to `${FRONTEND_URL}/settings/email-integration?zoho=connected` or `?zoho=error`. The frontend route is not implemented by this backend task.

## OAuth and Zoho API

The requested scopes are:

```text
ZohoMail.accounts.READ,ZohoMail.messages.CREATE
```

The Accounts URL and Mail URL are environment-configured because Zoho uses data-center-specific domains. The backend calls `GET /api/accounts` to choose the authorized mailbox and `POST /api/accounts/{accountId}/messages` to send. Zoho requires the `Authorization: Zoho-oauthtoken <access-token>` header for Mail API calls.

OAuth state is stored only as a SHA-256 hash, expires after ten minutes, is bound to the Admin ID and is consumed once. Refresh and access tokens are encrypted with AES-256-GCM using `ZOHO_TOKEN_ENCRYPTION_KEY`; no token is returned to the frontend or written to logs. Access tokens are refreshed automatically with a per-process lock. Invalid/revoked authorization changes the connection to `REAUTH_REQUIRED`.

## Assignment email behavior

The existing `publishAssignment` event runs after the lead transaction commits. It now inserts a deduplicated `email_notification_logs` row keyed by `leadId:executiveId:assignedAt`. This covers automatic assignment, manual assignment, transfer and SLA reassignment. If Zoho is unavailable, assignment remains successful and the job is retried for transient failures. Authorization/configuration failures are retained as failed records for Admin review and do not roll back the CRM operation.

The email contains the lead number, customer name, property, source, assignment time, CRM link and an HTML-escaped plain-text-safe template. It does not include customer phone or email.

## Environment variables

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REDIRECT_URI=https://reality-dewise.onrender.com/api/v1/auth/zoho/callback
ZOHO_ACCOUNTS_BASE_URL=https://accounts.zoho.in
ZOHO_MAIL_BASE_URL=https://mail.zoho.in
ZOHO_TOKEN_ENCRYPTION_KEY=<at least 32 random characters>
FRONTEND_URL=https://realty-adwise-fe.vercel.app
```

Use matching regional domains. For US use `accounts.zoho.com` and `mail.zoho.com`; for India use `.in`. Generate the encryption key with `openssl rand -hex 32`. Set all values in Render Environment, not in the frontend or repository.

## Migration and testing

```bash
npm run migrate:up
npm run typecheck
npm run build
npm test
```

Migrations `032_zoho_mail_integration.sql` and `033_zoho_email_controls.sql` create `zoho_oauth_states`, the singleton `zoho_mail_integrations` connection, and `email_notification_logs` with queue indexes, assignment-event uniqueness and an assignment timestamp snapshot. The current backend worker runs every 15 seconds inside `server.ts` and uses `FOR UPDATE SKIP LOCKED`; jobs survive restarts because they are stored in PostgreSQL.

This task intentionally does not add frontend settings screens, individual executive OAuth, Zoho CRM, portal integrations, or separate queue infrastructure such as Redis.
