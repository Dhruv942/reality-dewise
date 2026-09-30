import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { env } from '../src/config/env';
import { hashPassword } from '../src/utils/password';
import { upsertByEmail } from '../src/modules/users/user.repository';
import { authenticate, authorizeRoles } from '../src/modules/auth/auth.middleware';

const ADMIN = { email: 'admin@test.com', password: 'Admin-pass-123' };
const EXEC = { email: 'exec@test.com', password: 'Exec-pass-123' };
const INACTIVE = { email: 'gone@test.com', password: 'Gone-pass-123' };

let server: Server;
let base: string;
let adminId: string;
let execId: string;

const call = async (path: string, init: { method?: string; body?: unknown; token?: string; raw?: string } = {}) => {
  const res = await fetch(base + path, {
    method: init.method ?? (init.body !== undefined || init.raw !== undefined ? 'POST' : 'GET'),
    headers: {
      ...(init.body !== undefined || init.raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  });
  return { status: res.status, body: (await res.json()) as any };
};

const login = async (portal: 'admin' | 'executive', creds: object) =>
  call(`/api/v1/auth/${portal}/login`, { body: creds });

before(async () => {
  await pool.query('TRUNCATE users, teams CASCADE');
  const mk = async (u: typeof ADMIN, name: string, role: 'ADMIN' | 'EXECUTIVE') =>
    upsertByEmail({ name, email: u.email, username: u.email.split('@')[0], passwordHash: await hashPassword(u.password), role });
  adminId = (await mk(ADMIN, 'Admin', 'ADMIN')).id;
  execId = (await mk(EXEC, 'Amit', 'EXECUTIVE')).id;
  const gone = await mk(INACTIVE, 'Gone', 'EXECUTIVE');
  await pool.query('UPDATE users SET is_active = false WHERE id = $1', [gone.id]);

  // Admin-only endpoint that exists only for tests, to prove role protection.
  const app = createApp((api) => {
    api.get('/_test/admin-only', authenticate(), authorizeRoles('ADMIN'), (_req, res) => res.json({ ok: true }));
    api.get('/_test/exec-only', authenticate(), authorizeRoles('EXECUTIVE'), (_req, res) => res.json({ ok: true }));
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

describe('login + /me', () => {
  it('admin: login -> JWT -> /me', async () => {
    const r = await login('admin', ADMIN);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user, { id: adminId, name: 'Admin', email: ADMIN.email, role: 'ADMIN' });
    const me = await call('/api/v1/auth/me', { token: r.body.accessToken });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { id: adminId, name: 'Admin', email: ADMIN.email, role: 'ADMIN' });
  });

  it('executive: login -> JWT -> /me', async () => {
    const r = await login('executive', EXEC);
    assert.equal(r.status, 200);
    const me = await call('/api/v1/auth/me', { token: r.body.accessToken });
    assert.equal(me.status, 200);
    assert.deepEqual(me.body, { id: execId, name: 'Amit', email: EXEC.email, role: 'EXECUTIVE' });
  });

  it('JWT contains only sub, role and timing claims', async () => {
    const r = await login('admin', ADMIN);
    const claims = jwt.decode(r.body.accessToken) as Record<string, unknown>;
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'role', 'sub']);
  });

  it('never exposes password_hash', async () => {
    const r = await call('/api/v1/auth/admin/login', { body: ADMIN });
    assert.ok(!JSON.stringify(r.body).includes('password'));
    const me = await call('/api/v1/auth/me', { token: r.body.accessToken });
    assert.ok(!JSON.stringify(me.body).includes('password'));
  });

  it('email is case-insensitive', async () => {
    assert.equal((await login('admin', { email: 'ADMIN@Test.com', password: ADMIN.password })).status, 200);
  });
});

describe('invalid login', () => {
  it('wrong password -> 401 generic', async () => {
    const r = await login('admin', { email: ADMIN.email, password: 'wrong' });
    assert.equal(r.status, 401);
    assert.deepEqual(r.body, { success: false, message: 'Invalid email or password' });
  });

  it('unknown email gives the identical response as wrong password', async () => {
    const a = await login('admin', { email: 'nobody@test.com', password: 'whatever1' });
    const b = await login('admin', { email: ADMIN.email, password: 'whatever1' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.body, b.body);
  });

  it('executive cannot use admin login and vice versa (same generic error)', async () => {
    const a = await login('admin', EXEC);
    const b = await login('executive', ADMIN);
    for (const r of [a, b]) {
      assert.equal(r.status, 401);
      assert.deepEqual(r.body, { success: false, message: 'Invalid email or password' });
    }
  });

  it('inactive user cannot log in', async () => {
    assert.equal((await login('executive', INACTIVE)).status, 401);
  });

  it('validation errors -> 400 with field details', async () => {
    const r = await login('admin', { email: 'not-an-email' });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
    const fields = r.body.errors.map((e: any) => e.field).sort();
    assert.deepEqual(fields, ['email', 'password']);
  });

  it('malformed JSON -> 400, not 500', async () => {
    const r = await call('/api/v1/auth/admin/login', { raw: '{bad' });
    assert.equal(r.status, 400);
    assert.equal(r.body.success, false);
  });
});

describe('token rejection', () => {
  it('missing token -> 401', async () => {
    const r = await call('/api/v1/auth/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Authentication token missing');
  });

  it('non-Bearer scheme -> 401', async () => {
    const res = await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: 'Basic abc' } });
    assert.equal(res.status, 401);
  });

  it('garbage JWT -> 401 Invalid token', async () => {
    const r = await call('/api/v1/auth/me', { token: 'not.a.jwt' });
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Invalid token');
  });

  it('JWT signed with the wrong secret -> 401', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, 'x'.repeat(40), { subject: adminId });
    assert.equal((await call('/api/v1/auth/me', { token: t })).status, 401);
  });

  it('unsigned (alg=none) JWT -> 401', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, '', { subject: adminId, algorithm: 'none' });
    assert.equal((await call('/api/v1/auth/me', { token: t })).status, 401);
  });

  it('expired JWT -> 401 Token expired', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, { subject: adminId, expiresIn: -10 });
    const r = await call('/api/v1/auth/me', { token: t });
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Token expired');
  });

  it('token for a deleted/unknown user -> 401', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, { subject: '00000000-0000-0000-0000-000000000000' });
    assert.equal((await call('/api/v1/auth/me', { token: t })).status, 401);
  });

  it('token with non-uuid sub -> 401 (not 500)', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, { subject: 'abc' });
    assert.equal((await call('/api/v1/auth/me', { token: t })).status, 401);
  });

  it('token whose role no longer matches the DB -> 401', async () => {
    const t = jwt.sign({ role: 'ADMIN' }, env.JWT_SECRET, { subject: execId });
    assert.equal((await call('/api/v1/auth/me', { token: t })).status, 401);
  });

  it('deactivating a user invalidates their existing token', async () => {
    const r = await login('executive', EXEC);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [execId]);
    try {
      assert.equal((await call('/api/v1/auth/me', { token: r.body.accessToken })).status, 401);
    } finally {
      await pool.query('UPDATE users SET is_active = true WHERE id = $1', [execId]);
    }
  });
});

describe('role protection', () => {
  it('EXECUTIVE token on ADMIN-only endpoint -> 403', async () => {
    const t = (await login('executive', EXEC)).body.accessToken;
    const r = await call('/api/v1/_test/admin-only', { token: t });
    assert.equal(r.status, 403);
    assert.equal(r.body.success, false);
  });

  it('ADMIN token on ADMIN-only endpoint -> 200', async () => {
    const t = (await login('admin', ADMIN)).body.accessToken;
    assert.equal((await call('/api/v1/_test/admin-only', { token: t })).status, 200);
  });

  it('ADMIN token on EXECUTIVE-only endpoint -> 403; EXECUTIVE -> 200', async () => {
    const a = (await login('admin', ADMIN)).body.accessToken;
    const e = (await login('executive', EXEC)).body.accessToken;
    assert.equal((await call('/api/v1/_test/exec-only', { token: a })).status, 403);
    assert.equal((await call('/api/v1/_test/exec-only', { token: e })).status, 200);
  });

  it('no token on protected endpoint -> 401 (not 403)', async () => {
    assert.equal((await call('/api/v1/_test/admin-only')).status, 401);
  });
});

describe('misc', () => {
  it('unknown route -> 404 JSON', async () => {
    const r = await call('/api/v1/nope');
    assert.equal(r.status, 404);
    assert.equal(r.body.success, false);
  });
});
