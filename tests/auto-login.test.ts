import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mgr: any, exec: any;

const PASS = 'TempPass123';
const login = (body: unknown) => t.asToken('')('/auth/login', 'POST', body);

before(async () => {
  t = await startTestApp();
  mgr = await t.manager('al.mgr');
  exec = await t.exec('al.exec', mgr.id);
});
after(() => t.close());

describe('POST /auth/login: email + password only, the role comes from the database', () => {
  it('admin, manager and sales users each sign in at the same endpoint and get their own role', async () => {
    const a = await login({ email: 'admin@test.com', password: 'Admin-pass-123' });
    const m = await login({ email: 'al.mgr@test.com', password: PASS });
    const e = await login({ email: 'al.exec@test.com', password: PASS });
    assert.deepEqual([a.status, m.status, e.status], [200, 200, 200]);
    assert.deepEqual([a.body.user.role, m.body.user.role, e.body.user.role], ['ADMIN', 'MANAGER', 'SALES']);
    for (const r of [a, m, e]) assert.ok(r.body.accessToken && !JSON.stringify(r.body).includes('password'));
  });
  it('the returned token really is that role (and only that role)', async () => {
    const e = await login({ email: 'al.exec@test.com', password: PASS });
    const call = t.asToken(e.body.accessToken);
    assert.equal((await call('/auth/me')).body.role, 'SALES');
    assert.equal((await call('/executive/leads')).status, 200);
    assert.equal((await call('/admin/executives')).status, 403);
    assert.equal((await call('/manager/leads')).status, 403);
    assert.equal((await call('/view/executives')).status, 403);
  });
  it('a role (or anything else) supplied in the body is ignored: it cannot change who you are', async () => {
    for (const role of ['ADMIN', 'MANAGER', 'SALES', 'admin']) {
      const r = await login({ email: 'al.exec@test.com', password: PASS, role, userRole: role, portal: role });
      assert.equal(r.status, 200);
      assert.equal(r.body.user.role, 'SALES', `asked for ${role}`);
    }
    const r = await login({ email: 'al.mgr@test.com', password: PASS, role: 'ADMIN' });
    assert.equal(r.body.user.role, 'MANAGER');
    assert.equal((await t.asToken(r.body.accessToken)('/admin/executives')).status, 403);
  });
  it('wrong password, unknown email, empty body and bad types are refused with one generic message', async () => {
    const wrong = await login({ email: 'al.exec@test.com', password: 'nope-nope-1' });
    const unknown = await login({ email: 'nobody@test.com', password: PASS });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.message, unknown.body.message);
    assert.equal((await login({})).status, 400);
    assert.equal((await login({ email: 'al.exec@test.com' })).status, 400);
    assert.equal((await login({ email: 'not-an-email', password: PASS })).status, 400);
    assert.equal((await login({ email: { $ne: '' }, password: PASS })).status, 400);
  });
  it('an inactive account cannot sign in, and a live token dies when it is deactivated', async () => {
    const tok = (await login({ email: 'al.exec@test.com', password: PASS })).body.accessToken;
    await t.setActive(exec.id, false);
    const r = await login({ email: 'al.exec@test.com', password: PASS });
    assert.equal(r.status, 401);
    assert.equal(r.body.message, (await login({ email: 'nobody@test.com', password: PASS })).body.message);
    assert.equal((await t.asToken(tok)('/auth/me')).status, 401);
    await t.setActive(exec.id, true);
    assert.equal((await login({ email: 'al.exec@test.com', password: PASS })).status, 200);
  });
  it('the per-role endpoints still work and still refuse the wrong role (existing behaviour)', async () => {
    const as = (portal: string, email: string, password: string) => t.asToken('')(`/auth/${portal}/login`, 'POST', { email, password });
    assert.equal((await as('manager', 'al.mgr@test.com', PASS)).status, 200);
    assert.equal((await as('admin', 'al.mgr@test.com', PASS)).status, 401);
  });
});
