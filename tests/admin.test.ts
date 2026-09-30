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

const newTeam = async (name: string) => (await call('/admin/teams', 'POST', { name })).body;
const newExec = async (username: string, extra: object = {}) =>
  (await call('/admin/executives', 'POST', {
    name: username, email: `${username}@test.com`, username, password: 'TempPass123', ...extra,
  })).body;

before(async () => {
  await pool.query('TRUNCATE users, teams CASCADE');
  adminId = (await upsertByEmail({ name: 'Admin', email: 'admin@test.com', username: 'admin', passwordHash: await hashPassword('Admin-pass-123'), role: 'ADMIN' })).id;
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  adminToken = (await login('admin', 'admin@test.com', 'Admin-pass-123')).body.accessToken;
});
after(async () => { server.close(); await pool.end(); });

describe('access control', () => {
  it('no token -> 401, EXECUTIVE token -> 403 on admin routes', async () => {
    await newExec('gate');
    execToken = (await login('executive', 'gate@test.com', 'TempPass123')).body.accessToken;
    for (const path of ['/admin/teams', '/admin/executives']) {
      assert.equal((await call(path, 'GET', undefined, '')).status, 401);
      assert.equal((await call(path, 'GET', undefined, execToken)).status, 403);
    }
    assert.equal((await call('/admin/teams', 'POST', { name: 'X' }, execToken)).status, 403);
  });
});

describe('teams', () => {
  let id: string;
  it('create', async () => {
    const r = await call('/admin/teams', 'POST', { name: 'Team A', description: 'Main Ahmedabad sales team' });
    assert.equal(r.status, 201);
    assert.equal(r.body.name, 'Team A');
    assert.equal(r.body.isActive, true);
    assert.equal(r.body.executiveCount, 0);
    id = r.body.id;
  });
  it('list (with filter)', async () => {
    await newTeam('Team B');
    const all = await call('/admin/teams');
    assert.deepEqual(all.body.map((t: any) => t.name), ['Team A', 'Team B']);
    assert.equal((await call('/admin/teams?search=team%20b')).body.length, 1);
    assert.equal((await call('/admin/teams?isActive=false')).body.length, 0);
    assert.equal((await call('/admin/teams?isActive=maybe')).status, 400);
  });
  it('get single (with executives) / 404 / bad id', async () => {
    const r = await call(`/admin/teams/${id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.executives, []);
    assert.equal((await call('/admin/teams/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await call('/admin/teams/not-a-uuid')).status, 400);
  });
  it('update', async () => {
    const r = await call(`/admin/teams/${id}`, 'PATCH', { description: 'Updated', name: 'Team A1' });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'Team A1');
    assert.equal(r.body.description, 'Updated');
    assert.equal((await call(`/admin/teams/${id}`, 'PATCH', {})).status, 400);
    await call(`/admin/teams/${id}`, 'PATCH', { name: 'Team A' });
  });
  it('duplicate name (case-insensitive) -> 409', async () => {
    const r = await call('/admin/teams', 'POST', { name: 'team a' });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'A team with this name already exists');
    assert.equal((await call(`/admin/teams/${id}`, 'PATCH', { name: 'TEAM B' })).status, 409);
  });
  it('deactivate / reactivate', async () => {
    const t = await newTeam('Team Z');
    const r = await call(`/admin/teams/${t.id}/status`, 'PATCH', { isActive: false });
    assert.equal(r.status, 200);
    assert.equal(r.body.isActive, false);
    assert.equal((await call(`/admin/teams/${t.id}/status`, 'PATCH', { isActive: 'no' })).status, 400);
    assert.equal((await call(`/admin/teams/${t.id}/status`, 'PATCH', { isActive: true })).body.isActive, true);
  });
});

describe('executives', () => {
  let teamA: string;
  let amit: any;
  before(async () => { teamA = (await call('/admin/teams')).body.find((t: any) => t.name === 'Team A').id; });

  it('create without team', async () => {
    const r = await call('/admin/executives', 'POST', {
      name: 'Amit Patel', email: 'Amit@Test.com', phone: '9876543210', username: 'Amit.Patel', password: 'TempPassword123',
    });
    assert.equal(r.status, 201);
    amit = r.body;
    assert.equal(amit.email, 'amit@test.com');
    assert.equal(amit.username, 'amit.patel');
    assert.equal(amit.role, 'EXECUTIVE');
    assert.equal(amit.isActive, true);
    assert.equal(amit.team, null);
    assert.ok(!JSON.stringify(amit).includes('password'));
  });
  it('created executive can log in', async () => {
    assert.equal((await login('executive', 'amit@test.com', 'TempPassword123')).status, 200);
  });
  it('create with team', async () => {
    const r = await newExec('rahul', { teamId: teamA });
    assert.equal(r.team.id, teamA);
    assert.equal(r.team.name, 'Team A');
  });
  it('rejects role in body / weak password / bad teamId', async () => {
    const base = { name: 'X', email: 'x@test.com', username: 'xxx', password: 'TempPass123' };
    assert.equal((await call('/admin/executives', 'POST', { ...base, role: 'ADMIN' })).status, 400);
    assert.equal((await call('/admin/executives', 'POST', { ...base, password: 'short' })).status, 400);
    assert.equal((await call('/admin/executives', 'POST', { ...base, teamId: 'nope' })).status, 400);
  });
  it('create with non-existing team -> 400, inactive team -> 409', async () => {
    const base = { name: 'X', email: 'x@test.com', username: 'xxx', password: 'TempPass123' };
    assert.equal((await call('/admin/executives', 'POST', { ...base, teamId: '00000000-0000-0000-0000-000000000000' })).status, 400);
    const t = await newTeam('Dormant');
    await call(`/admin/teams/${t.id}/status`, 'PATCH', { isActive: false });
    assert.equal((await call('/admin/executives', 'POST', { ...base, teamId: t.id })).status, 409);
    // nothing half-created
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
    assert.equal(r.body.team, null);
    assert.equal((await call('/admin/executives/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.equal((await call(`/admin/executives/${adminId}`)).status, 400);
  });
  it('list + filters', async () => {
    assert.ok(!(await call('/admin/executives')).body.some((e: any) => e.role !== 'EXECUTIVE'), 'admins never listed');
    assert.deepEqual((await call(`/admin/executives?teamId=${teamA}`)).body.map((e: any) => e.username), ['rahul']);
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
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { teamId: teamA })).body.team.name, 'Team A');
    assert.equal((await call(`/admin/executives/${amit.id}`, 'PATCH', { teamId: null })).body.team, null);
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

describe('team assignment', () => {
  let team: string;
  let priya: any;
  before(async () => {
    team = (await newTeam('Assign Team')).id;
    priya = await newExec('priya');
  });

  it('assign -> team shows executive, executive shows team', async () => {
    const r = await call(`/admin/executives/${priya.id}/team`, 'PATCH', { teamId: team });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.team, { id: team, name: 'Assign Team', isActive: true });
    assert.equal((await call(`/admin/executives/${priya.id}`)).body.team.id, team);
    const t = await call(`/admin/teams/${team}/executives`);
    assert.deepEqual(t.body.team, { id: team, name: 'Assign Team' });
    assert.deepEqual(t.body.executives.map((e: any) => e.username), ['priya']);
    assert.equal(t.body.executives[0].isActive, true);
    assert.equal((await call(`/admin/teams/${team}`)).body.executiveCount, 1);
  });
  it('full flow: 3 executives in one team, deactivating one drops the active count only', async () => {
    const amit = (await call('/admin/executives?search=amit')).body[0];
    const rahul = (await call('/admin/executives?search=rahul')).body[0];
    for (const e of [amit, rahul]) await call(`/admin/executives/${e.id}/team`, 'PATCH', { teamId: team });
    const t = await call(`/admin/teams/${team}`);
    assert.equal(t.body.executives.length, 3);
    assert.equal(t.body.executiveCount, 3);
    await call(`/admin/executives/${rahul.id}/status`, 'PATCH', { isActive: false });
    const after = await call(`/admin/teams/${team}`);
    assert.equal(after.body.executives.length, 3, 'still a member');
    assert.equal(after.body.executiveCount, 2, 'but not counted as active');
    assert.equal((await login('executive', 'rahul@test.com', 'TempPass123')).status, 401);
  });
  it('assign inactive executive -> 409', async () => {
    const rahul = (await call('/admin/executives?search=rahul')).body[0];
    const t2 = await newTeam('Other');
    const r = await call(`/admin/executives/${rahul.id}/team`, 'PATCH', { teamId: t2.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'Executive is inactive');
  });
  it('assign to inactive team -> 409', async () => {
    const t = await newTeam('Closed');
    await call(`/admin/teams/${t.id}/status`, 'PATCH', { isActive: false });
    const r = await call(`/admin/executives/${priya.id}/team`, 'PATCH', { teamId: t.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'Team is inactive');
    assert.equal((await call(`/admin/executives/${priya.id}`)).body.team.id, team, 'unchanged');
  });
  it('assign to non-existing team -> 400; bad body -> 400', async () => {
    assert.equal((await call(`/admin/executives/${priya.id}/team`, 'PATCH', { teamId: '00000000-0000-0000-0000-000000000000' })).status, 400);
    assert.equal((await call(`/admin/executives/${priya.id}/team`, 'PATCH', {})).status, 400);
  });
  it('assign non-EXECUTIVE user (admin) -> rejected, and DB constraint backs it up', async () => {
    const r = await call(`/admin/executives/${adminId}/team`, 'PATCH', { teamId: team });
    assert.equal(r.status, 400);
    assert.equal(r.body.message, 'User is not an executive');
    await assert.rejects(pool.query('UPDATE users SET team_id=$1 WHERE id=$2', [team, adminId]), /users_team_only_executives_check/);
  });
  it('assign unknown executive -> 404', async () => {
    assert.equal((await call(`/admin/executives/00000000-0000-0000-0000-000000000000/team`, 'PATCH', { teamId: team })).status, 404);
  });
  it('team deactivation keeps membership (documented behaviour)', async () => {
    await call(`/admin/teams/${team}/status`, 'PATCH', { isActive: false });
    const e = await call(`/admin/executives/${priya.id}`);
    assert.equal(e.body.team.id, team);
    assert.equal(e.body.team.isActive, false);
    assert.equal((await call(`/admin/teams/${team}/executives`)).body.executives.length, 3);
    await call(`/admin/teams/${team}/status`, 'PATCH', { isActive: true });
  });
  it('teams cannot be hard-deleted while executives reference them', async () => {
    await assert.rejects(pool.query('DELETE FROM teams WHERE id=$1', [team]), /users_team_id_fkey/);
  });
  it('remove from team -> team_id NULL, account kept', async () => {
    const r = await call(`/admin/executives/${priya.id}/team`, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(r.body.team, null);
    assert.equal(r.body.isActive, true);
    const t = await call(`/admin/teams/${team}/executives`);
    assert.ok(!t.body.executives.some((e: any) => e.username === 'priya'));
    // removing again is a harmless no-op
    assert.equal((await call(`/admin/executives/${priya.id}/team`, 'DELETE')).status, 200);
  });
});
