import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('true').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  /** Default SLA for a freshly assigned lead. A project can override it via projects.sla_minutes. */
  DEFAULT_LEAD_SLA_MINUTES: z.coerce.number().int().positive().default(45),
  SLA_WARNING_MINUTES: z.coerce.number().int().positive().default(10),
  FOLLOW_UP_REMINDER_MINUTES: z.coerce.number().int().positive().default(15),
  FOLLOW_UP_MISSED_GRACE_MINUTES: z.coerce.number().int().positive().default(60),

  ENABLE_JOBS: bool,
  /** Mounts /api/v1/demo/* (reset + force SLA expiry). Never enable in production. */
  ENABLE_DEMO_ENDPOINTS: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  JOB_SLA_CRON: z.string().default('* * * * *'),
  JOB_FOLLOW_UP_CRON: z.string().default('* * * * *'),
});

export const env = schema.parse(process.env);
