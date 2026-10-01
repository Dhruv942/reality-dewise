import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client } from 'pg';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { env } from '../src/config/env';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

const listen = (app: ReturnType<typeof createApp>) => {
  const s = app.listen(0);
  return { s, base: `http://127.0.0.1:${(s.address() as AddressInfo).port}` };
};

describe('database connection loss', () => {
  it('server survives a dropped idle DB connection and keeps serving', async () => {
    const { s, base } = listen(createApp());
    try {
      await pool.query('SELECT 1'); // make sure an idle pooled connection exists
      const killer = new Client({ connectionString: env.DATABASE_URL });
      await killer.connect();
      const { rows } = await killer.query(
        `SELECT count(pg_terminate_backend(pid))::int n FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()`);
      await killer.end();
      assert.ok(rows[0].n >= 1, 'a connection was actually terminated');
      await new Promise((r) => setTimeout(r, 300)); // before the fix the process died right here
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { status: 'ok', db: 'up' });
    } finally { s.close(); }
  });

  it('/health returns 503 when the database is unreachable', async () => {
    const { s, base } = listen(createApp());
    const m = mock.method(pool, 'query', async () => { throw new Error('boom'); });
    try {
      const res = await fetch(`${base}/health`);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: 'unavailable', db: 'down' });
    } finally { m.mock.restore(); s.close(); }
  });
});

describe('login rate limiting', () => {
  it('blocks after N FAILED attempts with 429, on the real login routes', async () => {
    const { s, base } = listen(createApp(undefined, { loginRateLimitMax: 3 }));
    try {
      const post = (portal: string, body: object) =>
        fetch(`${base}/api/v1/auth/${portal}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const bad = { email: 'admin@test.com', password: 'wrong-password' };
      assert.deepEqual([(await post('admin', bad)).status, (await post('executive', bad)).status, (await post('admin', bad)).status], [401, 401, 401]);
      const blocked = await post('admin', bad);
      assert.equal(blocked.status, 429);
      assert.equal((await blocked.json()).success, false);
      assert.ok(blocked.headers.get('ratelimit') || blocked.headers.get('ratelimit-policy'), 'standard rate-limit headers');
      // even the right password is refused while blocked
      assert.equal((await post('admin', { email: 'admin@test.com', password: 'Admin-pass-123' })).status, 429);
    } finally { s.close(); }
  });

  it('successful logins are not counted', async () => {
    const { s, base } = listen(createApp(undefined, { loginRateLimitMax: 2 }));
    try {
      for (let i = 0; i < 6; i++) {
        const r = await fetch(`${base}/api/v1/auth/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.com', password: 'Admin-pass-123' }) });
        assert.equal(r.status, 200);
      }
    } finally { s.close(); }
  });
});

describe('CORS + security headers', () => {
  it('allows a configured origin, incl. preflight', async () => {
    const { s, base } = listen(createApp());
    try {
      const pre = await fetch(`${base}/api/v1/auth/admin/login`, { method: 'OPTIONS', headers: { origin: 'https://crm.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' } });
      assert.equal(pre.status, 204);
      assert.equal(pre.headers.get('access-control-allow-origin'), 'https://crm.example.com');
      const res = await fetch(`${base}/health`, { headers: { origin: 'https://crm.example.com' } });
      assert.equal(res.headers.get('access-control-allow-origin'), 'https://crm.example.com');
    } finally { s.close(); }
  });
  it('does not allow other origins', async () => {
    const { s, base } = listen(createApp());
    try {
      const res = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example.com' } });
      assert.equal(res.headers.get('access-control-allow-origin'), null);
    } finally { s.close(); }
  });
  it('sets security headers and hides x-powered-by', async () => {
    const { s, base } = listen(createApp());
    try {
      const res = await fetch(`${base}/health`);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.ok(res.headers.get('strict-transport-security'));
      assert.ok(res.headers.get('x-frame-options'));
      assert.equal(res.headers.get('x-powered-by'), null);
    } finally { s.close(); }
  });
});

describe('NUL bytes', () => {
  it('rejected with 400 in bodies and query strings, nothing stored', async () => {
    const r = await t.call('/admin/teams', 'POST', { name: 'bad\u0000name' });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, 'Validation failed');
    assert.equal((await t.call('/admin/executives?search=a%00b')).status, 400);
    assert.equal((await t.call('/admin/teams')).body.length, 0);
    assert.equal((await t.call('/auth/admin/login', 'POST', { email: 'a@b.com', password: 'x\u0000y' })).status, 400);
  });
});

describe('password change ends old sessions', () => {
  it('token issued before the change is rejected; tokens after it work', async () => {
    const team = await t.team('Sess');
    const e = await t.exec('sess.exec', team.id);
    const before = await t.login('executive', 'sess.exec@test.com', 'TempPass123');
    const meBefore = t.asToken(before);
    assert.equal((await meBefore('/auth/me')).status, 200);

    await new Promise((r) => setTimeout(r, 1100)); // JWT iat has 1-second resolution
    assert.equal((await t.call(`/admin/executives/${e.id}/password`, 'PATCH', { password: 'BrandNew-Pass-9' })).status, 200);

    const sameSecond = await t.login('executive', 'sess.exec@test.com', 'BrandNew-Pass-9');
    assert.equal((await t.asToken(sameSecond)('/auth/me')).status, 401, 'same-second token is rejected');
    const stale = await meBefore('/auth/me');
    assert.equal(stale.status, 401);
    assert.match(stale.body.message, /log in again/);
    await new Promise((r) => setTimeout(r, 1100)); // a token minted in the same second as the change is (deliberately) rejected too
    const fresh = await t.login('executive', 'sess.exec@test.com', 'BrandNew-Pass-9');
    assert.equal((await t.asToken(fresh)('/auth/me')).status, 200);
  });
});
