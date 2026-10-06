import { z } from 'zod';
import { pool } from '../src/database/pool';
import { hashPassword } from '../src/utils/password';
import { upsertByEmail } from '../src/modules/users/user.repository';
import type { UserDesignation, UserRole } from '../src/modules/users/user.model';

// No built-in default passwords: they must come from the environment.
const seedEnv = z.object({
  SEED_ADMIN_EMAIL: z.email().default('admin@example.com'),
  SEED_ADMIN_USERNAME: z.string().min(3).default('admin'),
  SEED_ADMIN_NAME: z.string().min(1).default('Admin'),
  SEED_ADMIN_PASSWORD: z.string().min(8, 'SEED_ADMIN_PASSWORD must be set (min 8 chars)'),
  SEED_EXECUTIVE_EMAIL: z.email().default('amit@example.com'),
  SEED_EXECUTIVE_USERNAME: z.string().min(3).default('amit'),
  SEED_EXECUTIVE_NAME: z.string().min(1).default('Amit'),
  SEED_EXECUTIVE_PASSWORD: z.string().min(8, 'SEED_EXECUTIVE_PASSWORD must be set (min 8 chars)'),
});

async function main(): Promise<void> {
  const parsed = seedEnv.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const s = parsed.data;

  const seeds: { name: string; email: string; username: string; password: string; role: UserRole; designation?: UserDesignation }[] = [
    { name: s.SEED_ADMIN_NAME, email: s.SEED_ADMIN_EMAIL, username: s.SEED_ADMIN_USERNAME, password: s.SEED_ADMIN_PASSWORD, role: 'ADMIN' },
    { name: s.SEED_EXECUTIVE_NAME, email: s.SEED_EXECUTIVE_EMAIL, username: s.SEED_EXECUTIVE_USERNAME, password: s.SEED_EXECUTIVE_PASSWORD, role: 'SALES', designation: 'SALES_EXECUTIVE' },
  ];

  for (const u of seeds) {
    const user = await upsertByEmail({ name: u.name, email: u.email, username: u.username, passwordHash: await hashPassword(u.password), role: u.role, designation: u.designation });
    console.log(`Seeded ${user.role}: ${user.email}`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
