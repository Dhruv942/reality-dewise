import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { hashPassword } from '../src/utils/password';
import { upsertByEmail } from '../src/modules/users/user.repository';

let server: Server;
let base: string;
let adminToken: string;
let execToken: string;
let adminId: string;

const call = async (path: string, method = 'GET', body?: unknown, token = adminToken) => {
  const res = await fetch(base + '/api/v1' + path, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};

const login = async (portal: string, email: string, password: string) =>
  call(`/auth/${portal}/login`, 'POST', { email, password }, '');

const newManager = async (username: string) =>
  (await call('/admin/managers', 'POST', { name: username, email: `${username}@test.com`, username, password: 'TempPass123' })).body;
const newExec = async (username: string, extra: object = {}) =>
  (await call('/admin/executives', 'POST', {
    name: username, email: `${username}@test.com`, username, password: 'TempPass123', ...extra,
  })).body;

before(async () => {
  await pool.query('TRUNCATE users CASCADE');
  adminId = (await upsertByEmail({ name: 'Admin', email: 'admin@test.com', username: 'admin', passwordHash: await hashPassword('Admin-pass-123'), role: 'ADMIN' })).id;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminToken = (await login('admin', 'admin@test.com', 'Admin-pass-123')).body.accessToken;
});
after(async () => { server.close(); await pool.end(); });

describe('access control', () => {
  it('no token -> 401, SALES token -> 403 on admin routes', async () => {
    await newExec('gate');
    execToken = (await login('executive', 'gate@test.com', 'TempPass123')).body.accessToken;
    for (const path of ['/admin/managers', '/admin/executives']) {
      assert.equal((await call(path, 'GET', undefined, '')).status, 401);
      assert.equal((await call(path, 'GET', undefined, execToken)).status, 403);
    }
    assert.equal((await call('/admin/teams', 'GET')).status, 404, 'the teams API no longer exists');
    assert.equal((await call('/admin/managers', 'POST', { name: 'X' }, execToken)).status, 403);
  });
});

describe('executives', () => {
  let mgrA: string;
  let amit: any;
  before(async () => { mgrA = (await newManager('mgr.a')).id; });

  it('create without manager', async () => {
    const r = await call('/admin/executives', 'POST', {
      name: 'Amit Patel', email: 'Amit@Test.com', phone: '9876543210', username: 'Amit.Patel', password: 'TempPassword123',
    });
    assert.equal(r.status, 201);
    amit = r.body;
    assert.equal(amit.email, 'amit@test.com');
    assert.equal(amit.username, 'amit.patel');
    assert.equal(amit.role, 'SALES');
    assert.equal(amit.designation, 'SALES_EXECUTIVE');
    assert.equal(amit.isActive, true);
    assert.equal(amit.manager, null);
    assert.ok(!JSON.stringify(amit).includes('password'));
  });
  it('created executive can log in', async () => {
    assert.equal((await login('executive', 'amit@test.com', 'TempPassword123')).status, 200);
  });
  it('create with manager', async () => {
    const r = await newExec('rahul', { managerId: mgrA });
    assert.deepEqual(r.manager, { id: mgrA, name: 'mgr.a', isActive: true });
  });
  it('rejects role in body / weak password / bad managerId', async () => {
    const base = { name: 'X', email: 'x@test.com', username: 'xxx', password: 'TempPass123' };
    assert.equal((await call('/admin/executives', 'POST', { ...base, role: 'ADMIN' })).status, 400);
    assert.equal((await call('/admin/executives', 'POST', { ...base, password: 'short' })).status, 400);
    assert.equal((await call('/admin/executives', 'POST', { ...base, managerId: 'nope' })).status, 400);
  });
  it('create with non-existing / non-manager / inactive manager -> 400 / 400 / 409, nothing half-created', async () => {
    const base = { name: 'X', email: 'x@test.com', username: 'xxx', password: 'TempPass123' };
    assert.equal((await call('/admin/executives', 'POST', { ...base, managerId: '00000000-0000-0000-0000-000000000000' })).status, 400);
    assert.equal((await call('/admin/executives', 'POST', { ...base, managerId: amit.id })).status, 400, 'a sales user is not a manager');
    const dormant = await newManager('mgr.dormant');
    await call(`/admin/managers/${dormant.id}/status`, 'PATCH', { isActive: false });
    assert.equal((await call('/admin/executives', 'POST', { ...base, managerId: dormant.id })).status, 409);
    assert.equal((await call('/admin/executives?search=xxx')).body.length, 0);
  });
  it('duplicate username / email / phone -> 409', async () => {
    const base = { name: 'D', email: 'd@test.com', username: 'dup', password: 'TempPass123' };
    assert.equal((await call('/admin/executives', 'POST', { ...base, username: 'amit.patel' })).body.message, 'Username is already in use');
    assert.equal((await call('/admin/executives', 'POST', { ...base, email: 'amit@test.com' })).body.message, 'Email is already in use');
    assert.equal((await call('/admin/executives', 'POST', { ...base, phone: '9876543210' })).body.message, 'Phone number is already in use');
    assert.equal((await call('/admin/executives', 'POST', { ...base, username: 'amit.patel' })).status, 409);
  });
  it('get single / 404 / admin id is not an executive', async () => {
    const r = await call(`/admin/executives/${amit.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.manager, null);
    assert.equal((await call('/admin/executives/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await call(`/admin/executives/${adminId}`)).status, 400);
  });
  it('list + filters', async () => {
    assert.ok(!(await call('/admin/executives')).body.some((e: any) => e.role !== 'SALES'), 'admins never listed');
    assert.deepEqual((await call(`/admin/executives?managerId=${mgrA}`)).body.map((e: any) => e.username), ['rahul']);
    assert.equal((await call('/admin/executives?search=9876543')).body[0].username, 'amit.patel');
    assert.equal((await call('/admin/executives?isActive=false')).body.length, 0);
    assert.equal((await call('/admin/executives?search=%25')).body.length, 0, 'LIKE wildcards are escaped');
  });
  it('update profile; cannot change role/password/isActive', async () => {
    const r = await call(`/admin/executives/${amit.id}`, 'PATCH', { name: 'Amit P.', phone: null, username: 'amit.p' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Amit P.');
    assert.equal(r.body.phone, null);
    assert.equal(r.body.username, 'amit.p');
    for (const bad of [{ role: 'ADMIN' }, { password: 'NewPassword123' }, { isActive: false }, {}]) {
      assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', bad)).status, 400);
    }
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { email: 'rahul@test.com' })).status, 409);
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { managerId: mgrA })).body.manager.name, 'mgr.a');
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { managerId: null })).body.manager, null);
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { teamId: mgrA })).status, 400, 'teamId is gone');
  });
  it('change password', async () => {
    const r = await call(`/admin/executives/${amit.id}/password`, 'PATCH', { password: 'NewPassword123' });
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes('assword123'));
    assert.equal((await login('executive', 'amit@test.com', 'TempPassword123')).status, 401);
    assert.equal((await login('executive', 'amit@test.com', 'NewPassword123')).status, 200);
    assert.equal((await call(`/admin/executives/${amit.id}/password`, 'PATCH', { password: 'x' })).status, 400);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [amit.id]);
    assert.match(rows[0].password_hash, /^\$argon2id\$/);
  });
  it('deactivate: cannot login, existing token dies, can reactivate', async () => {
    const token = (await login('executive', 'amit@test.com', 'NewPassword123')).body.accessToken;
    const r = await call(`/admin/executives/${amit.id}/status`, 'PATCH', { isActive: false });
    assert.equal(r.body.isActive, false);
    assert.equal((await login('executive', 'amit@test.com', 'NewPassword123')).status, 401);
    assert.equal((await call('/auth/me', 'GET', undefined, token)).status, 401);
    assert.equal((await call('/admin/executives?isActive=false')).body.length, 1);
    await call(`/admin/executives/${amit.id}/status`, 'PATCH', { isActive: true });
    assert.equal((await login('executive', 'amit@test.com', 'NewPassword123')).status, 200);
  });
  it('DELETE is a soft delete: row kept, hidden, cannot login or be reactivated', async () => {
    const e = await newExec('temp');
    const r = await call(`/admin/executives/${e.id}`, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(r.body.executive.isActive, false);
    const { rows } = await pool.query('SELECT is_active, deleted_at FROM users WHERE id=$1', [e.id]);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].deleted_at);
    assert.equal((await call(`/admin/executives/${e.id}`)).status, 404);
    assert.equal((await call('/admin/executives?search=temp')).body.length, 0);
    assert.equal((await call(`/admin/executives/${e.id}/status`, 'PATCH', { isActive: true })).status, 404);
    assert.equal((await login('executive', 'temp@test.com', 'TempPass123')).status, 401);
  });
});

describe('manager assignment', () => {
  let mgr: any;
  let priya: any;
  before(async () => {
    mgr = await newManager('mgr.assign');
    priya = await newExec('priya');
  });

  it('assign -> executive shows manager, manager detail lists the executive', async () => {
    const r = await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: mgr.id });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.manager, { id: mgr.id, name: 'mgr.assign', isActive: true });
    const m = await call(`/admin/managers/${mgr.id}`);
    assert.deepEqual(m.body.executives.map((e: any) => e.username), ['priya']);
    assert.equal(m.body.manager, null, 'a manager has no manager');
    assert.deepEqual((await call(`/admin/executives?managerId=${mgr.id}`)).body.map((e: any) => e.username), ['priya']);
  });
  it('reassigning moves the executive to the other manager', async () => {
    const other = await newManager('mgr.other');
    assert.equal((await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: other.id })).body.manager.id, other.id);
    assert.equal((await call(`/admin/managers/${mgr.id}`)).body.executives.length, 0);
    await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: mgr.id });
  });
  it('inactive executive -> 409; inactive / unknown / non-manager target -> 409 / 400 / 400; bad body -> 400', async () => {
    const off = await newExec('off.exec');
    await call(`/admin/executives/${off.id}/status`, 'PATCH', { isActive: false });
    const r = await call(`/admin/executives/${off.id}/manager`, 'PATCH', { managerId: mgr.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'Executive is inactive');
    const off2 = await newManager('mgr.off');
    await call(`/admin/managers/${off2.id}/status`, 'PATCH', { isActive: false });
    const to = await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: off2.id });
    assert.equal(to.status, 409);
    assert.equal(to.body.message, 'Manager is inactive');
    assert.equal((await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: '00000000-0000-0000-0000-000000000000' })).status, 400);
    assert.equal((await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: adminId })).status, 400);
    assert.equal((await call(`/admin/executives/${priya.id}/manager`, 'PATCH', {})).status, 400);
    assert.equal((await call(`/admin/executives/${priya.id}`)).body.manager.id, mgr.id, 'unchanged');
  });
  it('only sales users have a manager: admin and manager targets are rejected, and the DB backs it up', async () => {
    const r = await call(`/admin/executives/${adminId}/manager`, 'PATCH', { managerId: mgr.id });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, 'User is not an executive');
    await assert.rejects(pool.query('UPDATE users SET manager_id=$1 WHERE id=$2', [mgr.id, adminId]), /users_manager_only_for_sales_check/);
    assert.equal((await call(`/admin/managers/${mgr.id}`, 'PATCH', { managerId: mgr.id })).status, 400);
  });
  it('unknown executive -> 404', async () => {
    assert.equal((await call(`/admin/executives/00000000-0000-0000-0000-000000000000/manager`, 'PATCH', { managerId: mgr.id })).status, 404);
  });
  it('a manager with executives cannot be hard-deleted; soft-deleting releases them (account and history kept)', async () => {
    await assert.rejects(pool.query('DELETE FROM users WHERE id=$1', [mgr.id]), /users_manager_id_fkey/);
    assert.equal((await call(`/admin/managers/${mgr.id}`, 'DELETE')).status, 200);
    assert.equal((await call(`/admin/executives/${priya.id}`)).body.manager, null);
  });
  it('remove manager -> manager_id NULL, account kept; repeating is a no-op', async () => {
    const m2 = await newManager('mgr.remove');
    await call(`/admin/executives/${priya.id}/manager`, 'PATCH', { managerId: m2.id });
    const r = await call(`/admin/executives/${priya.id}/manager`, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(r.body.manager, null);
    assert.equal(r.body.isActive, true);
    assert.equal((await call(`/admin/executives/${priya.id}/manager`, 'DELETE')).status, 200);
  });
});
