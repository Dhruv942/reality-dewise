import { z } from 'zod';
import { pool } from '../src/database/pool';
import { hashPassword } from '../src/utils/password';
import { upsertByEmail } from '../src/modules/users/user.repository';
import type { UserDesignation, UserRole } from '../src/modules/users/user.model';

// An empty value (as in .env.example) means "not set": that account is skipped.
const optionalPassword = (name: string) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(8, `${name} must be at least 8 chars`).optional());

// No built-in default passwords: they must come from the environment.
const seedEnv = z.object({
  SEED_ADMIN_EMAIL: z.email().default('admin@example.com'),
  SEED_ADMIN_USERNAME: z.string().min(3).default('admin'),
  SEED_ADMIN_NAME: z.string().min(1).default('Admin'),
  SEED_ADMIN_PASSWORD: z.string().min(8, 'SEED_ADMIN_PASSWORD must be set (min 8 chars)'),

  // The manager is optional so existing deployments (whose environment has no manager variables) keep seeding.
  SEED_MANAGER_EMAIL: z.email().default('manager@example.com'),
  SEED_MANAGER_USERNAME: z.string().min(3).default('manager'),
  SEED_MANAGER_NAME: z.string().min(1).default('Manager'),
  SEED_MANAGER_PASSWORD: optionalPassword('SEED_MANAGER_PASSWORD'),

  // Executive 1 is required (as before); executives 2 and 3 are optional.
  SEED_EXECUTIVE_EMAIL: z.email().default('amit@example.com'),
  SEED_EXECUTIVE_USERNAME: z.string().min(3).default('amit'),
  SEED_EXECUTIVE_NAME: z.string().min(1).default('Amit'),
  SEED_EXECUTIVE_PASSWORD: z.string().min(8, 'SEED_EXECUTIVE_PASSWORD must be set (min 8 chars)'),
  SEED_EXECUTIVE_2_EMAIL: z.email().default('rahul@example.com'),
  SEED_EXECUTIVE_2_USERNAME: z.string().min(3).default('rahul'),
  SEED_EXECUTIVE_2_NAME: z.string().min(1).default('Rahul'),
  SEED_EXECUTIVE_2_PASSWORD: optionalPassword('SEED_EXECUTIVE_2_PASSWORD'),
  SEED_EXECUTIVE_3_EMAIL: z.email().default('priya@example.com'),
  SEED_EXECUTIVE_3_USERNAME: z.string().min(3).default('priya'),
  SEED_EXECUTIVE_3_NAME: z.string().min(1).default('Priya'),
  SEED_EXECUTIVE_3_PASSWORD: optionalPassword('SEED_EXECUTIVE_3_PASSWORD'),

  // The team the seeded manager leads and the seeded executives belong to.
  SEED_TEAM_NAME: z.string().min(1).default('Sales Team'),
});

interface SeedUser {
  name: string;
  email: string;
  username: string;
  password: string;
  role: UserRole;
  designation?: UserDesignation;
}

async function main(): Promise<void> {
  const parsed = seedEnv.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const s = parsed.data;

  const seeds: SeedUser[] = [
    { name: s.SEED_ADMIN_NAME, email: s.SEED_ADMIN_EMAIL, username: s.SEED_ADMIN_USERNAME, password: s.SEED_ADMIN_PASSWORD, role: 'ADMIN' },
  ];
  if (s.SEED_MANAGER_PASSWORD) {
    seeds.push({ name: s.SEED_MANAGER_NAME, email: s.SEED_MANAGER_EMAIL, username: s.SEED_MANAGER_USERNAME, password: s.SEED_MANAGER_PASSWORD, role: 'MANAGER', designation: 'MANAGER' });
  } else {
    console.log('SEED_MANAGER_PASSWORD is not set: skipping the manager (set it to seed one).');
  }
  const executives: [string, string, string, string | undefined][] = [
    [s.SEED_EXECUTIVE_NAME, s.SEED_EXECUTIVE_EMAIL, s.SEED_EXECUTIVE_USERNAME, s.SEED_EXECUTIVE_PASSWORD],
    [s.SEED_EXECUTIVE_2_NAME, s.SEED_EXECUTIVE_2_EMAIL, s.SEED_EXECUTIVE_2_USERNAME, s.SEED_EXECUTIVE_2_PASSWORD],
    [s.SEED_EXECUTIVE_3_NAME, s.SEED_EXECUTIVE_3_EMAIL, s.SEED_EXECUTIVE_3_USERNAME, s.SEED_EXECUTIVE_3_PASSWORD],
  ];
  executives.forEach(([name, email, username, password], i) => {
    if (password) seeds.push({ name, email, username, password, role: 'SALES', designation: 'SALES_EXECUTIVE' });
    else console.log(`SEED_EXECUTIVE_${i + 1}_PASSWORD is not set: skipping executive ${i + 1}.`);
  });

  const seeded: { id: string; role: UserRole }[] = [];
  for (const u of seeds) {
    const user = await upsertByEmail({ name: u.name, email: u.email, username: u.username, passwordHash: await hashPassword(u.password), role: u.role, designation: u.designation });
    seeded.push({ id: user.id, role: user.role });
    console.log(`Seeded ${user.role}${user.designation ? ` (${user.designation})` : ''}: ${user.email} / username "${user.username}"`);
  }

  // Put the manager and the executives together so the manager sees their leads and can assign to them.
  const manager = seeded.find((u) => u.role === 'MANAGER');
  const executiveIds = seeded.filter((u) => u.role === 'SALES').map((u) => u.id);
  if (manager && executiveIds.length > 0) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO teams (name, description, manager_id) VALUES ($1, 'Seeded team', $2)
       ON CONFLICT (lower(name)) DO UPDATE SET manager_id = EXCLUDED.manager_id
       RETURNING id`,
      [s.SEED_TEAM_NAME, manager.id],
    );
    await pool.query('UPDATE users SET team_id = $1 WHERE id = ANY($2::uuid[])', [rows[0].id, executiveIds]);
    console.log(`Team "${s.SEED_TEAM_NAME}": led by the manager, with ${executiveIds.length} executive(s) as members`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
