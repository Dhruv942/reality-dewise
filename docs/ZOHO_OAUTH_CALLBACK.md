# Zoho OAuth Callback

This is the initial callback boundary for a future Zoho Mail OAuth 2.0 integration. It only validates that Zoho returned an authorization response and acknowledges receipt. It does not yet verify `state`, exchange the authorization code, or store tokens.

## Endpoint

```text
GET /api/v1/auth/zoho/callback
```

The route is intentionally public because Zoho redirects the user's browser to it. OAuth state verification and code exchange must be added before using this endpoint in a production integration.

## Redirect URI configuration

For local development, enter this exact URI in the Zoho API Console:

```text
http://localhost:4000/api/v1/auth/zoho/callback
```

For the currently deployed Render service, the URI is:

```text
https://reality-dewise.onrender.com/api/v1/auth/zoho/callback
```

If the production hostname changes, replace only the hostname and keep the `/api/v1/auth/zoho/callback` path. The redirect URI sent during authorization must exactly match the URI registered in Zoho, including the scheme, path and trailing-slash choice.

## Current behavior

Successful callback:

```text
GET /api/v1/auth/zoho/callback?code=<authorization-code>&state=<opaque-state>
```

Response (`200`):

```json
{
  "success": true,
  "message": "Zoho OAuth callback received",
  "nextStep": "authorization_code_exchange_pending"
}
```

The code and state are deliberately not returned or logged.

If either required parameter is missing, the endpoint returns the normal CRM validation envelope with HTTP `400`. If Zoho returns an OAuth error such as `access_denied`, the endpoint returns HTTP `400` with the generic message `Zoho authorization was not granted`; provider error values and descriptions are not echoed.

## Deferred work

The later Zoho integration task should add, behind this route boundary:

- cryptographically safe state creation and verification;
- authorization-code exchange with Zoho;
- encrypted access/refresh-token storage and rotation;
- Zoho Mail account retrieval; and
- email notification integration.

Use HTTPS for the deployed callback and never place authorization codes or tokens in logs, query strings outside the provider redirect, or user-facing response bodies.
