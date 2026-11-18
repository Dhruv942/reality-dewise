import { z } from 'zod';

const schema = z.object({
  // Defaults to production so a host that forgets to set it never exposes dev-only routes.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(0).default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('1h'),
  /** How long a login can be renewed without typing the password again, counted from the login (never extended). */
  REFRESH_EXPIRES_IN: z.string().min(1).default('30d'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Comma-separated browser origins allowed to call the API, e.g. "https://crm.example.com". Empty = no CORS. */
  CORS_ORIGINS: z.string().default(''),
  /** Number of reverse proxies in front of the app (so req.ip is the real client). Unset = none. */
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),
  /** Runs the lead timeout reassignment sweep inside the API process (set to false to run it elsewhere). */
  LEAD_TIMEOUT_JOB_ENABLED: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  /** How often the sweep looks for timed-out leads. The SLA duration itself is an admin setting (default 90 minutes, counted 24/7). */
  LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
  /** Minutes before the SLA expires at which the assigned executive is warned (0 = no warning). Capped at half the SLA. */
  SLA_WARNING_MINUTES: z.coerce.number().int().min(0).default(10),
  /** Comma-separated browser origins allowed to open a Socket.IO connection. Empty = same as CORS_ORIGINS. */
  SOCKET_CORS_ORIGIN: z.string().default(''),
  /** Web Push (VAPID). Generate with: npx web-push generate-vapid-keys. All three set = push on; none = off. */
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  /** A contact for the push services, e.g. "mailto:ops@example.com". */
  VAPID_SUBJECT: z.string().min(1).optional(),
  /** Shared secrets for the portal webhooks (header `x-webhook-secret`, `Authorization: Bearer` or `?token=`). Unset = open (warned at startup in production). */
  MAGICBRICKS_WEBHOOK_SECRET: z.string().min(16, 'MAGICBRICKS_WEBHOOK_SECRET must be at least 16 characters').optional(),
  ACRES99_WEBHOOK_SECRET: z.string().min(16, 'ACRES99_WEBHOOK_SECRET must be at least 16 characters').optional(),
  /** Requests per minute per IP on each portal webhook. Portals send from few IPs, so keep this generous. */
  WEBHOOK_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
  /** Postgres per-statement and idle-in-transaction limits (ms) so a stuck query cannot hold a connection or lock forever. */
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30_000),
  /** Force-exit deadline (ms) for a graceful shutdown. */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(10_000),
  /** Node keep-alive timeout (ms). Keep it ABOVE the reverse proxy's idle timeout (commonly 60s) to avoid 502s. */
  KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(1000).default(65_000),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
  ZOHO_CLIENT_ID: z.string().min(1).optional(),
  ZOHO_CLIENT_SECRET: z.string().min(1).optional(),
  ZOHO_REDIRECT_URI: z.string().url().optional(),
  ZOHO_ACCOUNTS_BASE_URL: z.string().url().optional(),
  ZOHO_MAIL_BASE_URL: z.string().url().optional(),
  ZOHO_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
});

const parsed = schema.safeParse(process.env);
const vapidSet = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter((k) => process.env[k]);
if (vapidSet.length > 0 && vapidSet.length < 3) {
  throw new Error('Invalid environment configuration:\n  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set together');
}
if (!parsed.success) {
  // Only field names/messages are printed, never the values.
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
}

const origins = (v: string) => v.split(',').map((o) => o.trim()).filter(Boolean);
const corsOrigins = origins(parsed.data.CORS_ORIGINS);
const socketOrigins = origins(parsed.data.SOCKET_CORS_ORIGIN);

export const env = { ...parsed.data, pushEnabled: vapidSet.length === 3, corsOrigins, socketCorsOrigins: socketOrigins.length > 0 ? socketOrigins : corsOrigins };
