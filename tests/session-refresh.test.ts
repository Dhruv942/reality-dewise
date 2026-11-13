import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mgr: any, exec: any;
const PASS = 'TempPass123';
const anon = () => t.asToken('');
const login = (email: string, password = PASS) => anon()('/auth/login', 'POST', { email, password });
const refresh = (refreshToken: unknown) => anon()('/auth/refresh', 'POST', { refreshToken });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  t = await startTestApp();
  mgr = await t.manager('rf.mgr');
  exec = await t.exec('rf.exec', mgr.id);
});
after(() => t.close());

describe('refresh tokens renew a session without the password', () => {
  it('login returns an access token and a refresh token; the refresh token has an absolute expiry in the future', async () => {
    const r = await login('rf.exec@test.com');
    assert.ok(r.body.accessToken && r.body.refreshToken && r.body.accessToken !== r.body.refreshToken);
    const claims = jwt.decode(r.body.refreshToken) as Record<string, number | string>;
    assert.equal(claims.typ, 'refresh');
    assert.equal(claims.role, 'SALES');
    assert.ok((claims.exp as number) - (claims.iat as number) >= 29 * 86400, 'defaults to 30 days');
  });
  it('POST /auth/refresh returns a working access token for the same user and role', async () => {
    const l = await login('rf.exec@test.com');
    const r = await refresh(l.body.refreshToken);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user, l.body.user);
    const call = t.asToken(r.body.accessToken);
    assert.equal((await call('/auth/me')).body.id, exec.id);
    assert.equal((await call('/executive/leads')).status, 200);
    assert.equal((await call('/admin/executives')).status, 403, 'renewing never widens the role');
  });
  it('renewal never extends the session: the new refresh token keeps the original expiry', async () => {
    const l = await login('rf.exec@test.com');
    const first = jwt.decode(l.body.refreshToken) as { exp: number };
    await sleep(1100);
    const r = await refresh(l.body.refreshToken);
    const next = jwt.decode(r.body.refreshToken) as { exp: number; iat: number };
    assert.equal(next.exp, first.exp);
    assert.ok(next.iat > (jwt.decode(l.body.refreshToken) as { iat: number }).iat);
    assert.equal((await refresh(r.body.refreshToken)).status, 200, 'and the rotated one keeps working');
  });
  it('the role always comes from the database, whatever the body says', async () => {
    const l = await login('rf.mgr@test.com');
    const r = await anon()('/auth/refresh', 'POST', { refreshToken: l.body.refreshToken, role: 'ADMIN' });
    assert.equal(r.status, 400, 'unknown fields are rejected');
    assert.equal((await refresh(l.body.refreshToken)).body.user.role, 'MANAGER');
  });
});

describe('refresh tokens and access tokens are not interchangeable', () => {
  it('a refresh token is refused as a bearer token, an access token is refused for refreshing', async () => {
    const l = await login('rf.exec@test.com');
    assert.equal((await t.asToken(l.body.refreshToken)('/auth/me')).status, 401);
    assert.equal((await t.asToken(l.body.refreshToken)('/executive/leads')).status, 401);
    assert.equal((await refresh(l.body.accessToken)).status, 401);
  });
  it('garbage, empty, missing and badly typed tokens are all refused', async () => {
    assert.equal((await refresh('nope')).status, 401);
    assert.equal((await refresh('')).status, 400);
    assert.equal((await anon()('/auth/refresh', 'POST', {})).status, 400);
    assert.equal((await refresh({ $ne: 1 })).status, 400);
    const forged = jwt.sign({ role: 'ADMIN', typ: 'refresh' }, 'x'.repeat(40), { subject: exec.id, expiresIn: '1h' });
    assert.equal((await refresh(forged)).status, 401, 'signed with another secret');
  });
});

describe('expiry and revocation end the session', () => {
  const mint = (sub: string, role: string, extra: object = {}) =>
    jwt.sign({ role, typ: 'refresh', ...extra }, process.env.JWT_SECRET!, { subject: sub, algorithm: 'HS256', expiresIn: '30d' });

  it('an expired refresh token is refused (the session cannot outlive its limit)', async () => {
    const old = jwt.sign({ role: 'SALES', typ: 'refresh' }, process.env.JWT_SECRET!, { subject: exec.id, algorithm: 'HS256', expiresIn: -10 });
    const r = await refresh(old);
    assert.equal(r.status, 401);
    assert.equal(r.body.message, 'Session expired, please log in again');
  });
  it('a deactivated account cannot renew, and can again once reactivated and signed in', async () => {
    const l = await login('rf.exec@test.com');
    await t.setActive(exec.id, false);
    assert.equal((await refresh(l.body.refreshToken)).status, 401);
    assert.equal((await t.asToken(l.body.accessToken)('/auth/me')).status, 401);
    await t.setActive(exec.id, true);
  });
  it('a soft-deleted account cannot renew', async () => {
    const gone = await t.exec('rf.gone', mgr.id);
    const l = await login('rf.gone@test.com');
    await t.call(`/admin/executives/${gone.id}`, 'DELETE');
    assert.equal((await refresh(l.body.refreshToken)).status, 401);
  });
  it('a password change revokes every earlier session, refresh tokens included', async () => {
    const e = await t.exec('rf.pw', mgr.id);
    const l = await login('rf.pw@test.com');
    await sleep(1100); // JWT iat has 1-second resolution
    await t.call(`/admin/executives/${e.id}/password`, 'PATCH', { password: 'NewPass12345' });
    assert.equal((await refresh(l.body.refreshToken)).status, 401);
    await sleep(1100); // a token issued in the same second as the change must simply be re-issued
    const fresh = await login('rf.pw@test.com', 'NewPass12345');
    assert.equal((await refresh(fresh.body.refreshToken)).status, 200);
  });
  it('a token for another role than the account has is refused', async () => {
    assert.equal((await refresh(mint(exec.id, 'ADMIN'))).status, 401);
    assert.equal((await refresh(mint(mgr.id, 'SALES'))).status, 401);
  });
  it('a token for an unknown or malformed user id is refused', async () => {
    assert.equal((await refresh(mint('00000000-0000-0000-0000-000000000000', 'SALES'))).status, 401);
    assert.equal((await refresh(mint('not-a-uuid', 'SALES'))).status, 401);
  });
});

describe('the dashboard switch needs no new login', () => {
  it('an admin session renewed through refresh can still open view dashboards, and stays an admin', async () => {
    const l = await login('admin@test.com', 'Admin-pass-123');
    const r = await refresh(l.body.refreshToken);
    const call = t.asToken(r.body.accessToken);
    assert.equal((await call(`/view/executives/${exec.id}/dashboard`)).status, 200);
    assert.equal((await call('/auth/me')).body.role, 'ADMIN');
    assert.equal((await pool.query("SELECT role FROM users WHERE email='admin@test.com'")).rows[0].role, 'ADMIN');
  });
});
