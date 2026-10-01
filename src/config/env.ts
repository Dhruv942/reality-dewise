import { z } from 'zod';

const schema = z.object({
  // Defaults to production so a host that forgets to set it never exposes dev-only routes.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().min(0).default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().min(1).default('1h'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Comma-separated browser origins allowed to call the API, e.g. "https://crm.example.com". Empty = no CORS. */
  CORS_ORIGINS: z.string().default(''),
  /** Number of reverse proxies in front of the app (so req.ip is the real client). Unset = none. */
  TRUST_PROXY: z.coerce.number().int().min(0).optional(),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).default(15),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Only field names/messages are printed, never the values.
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`);
}

export const env = { ...parsed.data, corsOrigins: parsed.data.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) };
