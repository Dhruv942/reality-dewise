import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;

before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('designation: Sales Executive and Executive Manager are one role', () => {
  it('sales users default to SALES_EXECUTIVE; EXECUTIVE_MANAGER is a designation, not a new role', async () => {
    const a = await t.exec('desig.a');
    const b = await t.exec('desig.b', undefined, 'EXECUTIVE_MANAGER');
    assert.deepEqual([a.role, a.designation], ['SALES', 'SALES_EXECUTIVE']);
    assert.deepEqual([b.role, b.designation], ['SALES', 'EXECUTIVE_MANAGER']);
    const up = await t.call(`/admin/executives/${a.id}`, 'PATCH', { designation: 'EXECUTIVE_MANAGER' });
    assert.equal(up.body.designation, 'EXECUTIVE_MANAGER');
    assert.equal(up.body.role, 'SALES');
  });
  it('designation is validated: MANAGER / junk cannot be given to a sales user', async () => {
    for (const designation of ['MANAGER', 'BOSS', 'sales']) {
      const r = await t.call('/admin/executives', 'POST', { name: 'X', email: `x${designation}@t.com`, username: `x-${designation}`, password: 'TempPass123', designation });
      assert.equal(r.status, 400, designation);
    }
    const a = await t.exec('desig.c');
    assert.equal((await t.call(`/admin/executives/${a.id}`, 'PATCH', { designation: 'MANAGER' })).status, 400);
    assert.equal((await t.call(`/admin/executives/${a.id}`, 'PATCH', { role: 'MANAGER' })).status, 400, 'role cannot be changed through the API');
  });
  it('the database refuses a role/designation mismatch', async () => {
    const a = await t.exec('desig.d');
    await assert.rejects(pool.query("UPDATE users SET designation = 'MANAGER' WHERE id = $1", [a.id]), /users_designation_matches_role_check/);
    await assert.rejects(pool.query("UPDATE users SET designation = 'SALES_EXECUTIVE' WHERE role = 'ADMIN'"), /users_designation_matches_role_check/);
  });
  it('/auth/me reports role and designation', async () => {
    const e = await t.exec('desig.me', undefined, 'EXECUTIVE_MANAGER');
    const me = await t.asToken(await t.login('executive', 'desig.me@test.com', 'TempPass123'))('/auth/me');
    assert.equal(me.body.role, 'SALES');
    assert.equal(me.body.designation, 'EXECUTIVE_MANAGER');
    assert.equal(me.body.id, e.id);
  });
});

describe('manager accounts (admin creates and manages them)', () => {
  let m: any;
  it('create: role MANAGER, designation MANAGER, own username/email/password', async () => {
    m = await t.manager('mgr.one');
    assert.deepEqual([m.role, m.designation, m.username, m.isActive, m.team], ['MANAGER', 'MANAGER', 'mgr.one', true, null]);
    assert.equal((await t.call('/admin/managers', 'POST', { name: 'Dup', email: 'mgr.one@test.com', username: 'other', password: 'TempPass123' })).status, 409);
    assert.equal((await t.call('/admin/managers', 'POST', { name: 'Dup', email: 'd@test.com', username: 'mgr.one', password: 'TempPass123' })).status, 409);
  });
  it('validation: no team membership, designation or role on a manager; weak password', async () => {
    const base = { name: 'M', email: 'mv@test.com', username: 'mgr.v', password: 'TempPass123' };
    for (const extra of [{ teamId: ZERO }, { designation: 'MANAGER' }, { role: 'ADMIN' }, { password: 'short' }]) {
      assert.equal((await t.call('/admin/managers', 'POST', { ...base, ...extra })).status, 400, JSON.stringify(extra));
    }
  });
  it('managers and sales users are listed separately and are not interchangeable', async () => {
    const e = await t.exec('mgr.sales');
    assert.ok((await t.call('/admin/managers')).body.every((x: any) => x.role === 'MANAGER'));
    assert.ok((await t.call('/admin/executives')).body.every((x: any) => x.role === 'SALES'));
    assert.equal((await t.call(`/admin/executives/${m.id}`)).status, 400);
    assert.equal((await t.call(`/admin/managers/${e.id}`)).status, 400);
    assert.equal((await t.call(`/admin/managers/${ZERO}`)).status, 404);
  });
  it('update, password change, deactivate (cannot log in), reactivate', async () => {
    assert.equal((await t.call(`/admin/managers/${m.id}`, 'PATCH', { name: 'Manager One', phone: '+919800000001' })).body.name, 'Manager One');
    assert.equal((await t.call(`/admin/managers/${m.id}`, 'PATCH', {})).status, 400);
    assert.ok(await t.login('manager', 'mgr.one@test.com', 'TempPass123'));
    await t.call(`/admin/managers/${m.id}/password`, 'PATCH', { password: 'NewPass12345' });
    assert.equal(await t.login('manager', 'mgr.one@test.com', 'TempPass123'), undefined);
    assert.ok(await t.login('manager', 'mgr.one@test.com', 'NewPass12345'));
    await t.call(`/admin/managers/${m.id}/status`, 'PATCH', { isActive: false });
    assert.equal(await t.login('manager', 'mgr.one@test.com', 'NewPass12345'), undefined);
    await t.call(`/admin/managers/${m.id}/status`, 'PATCH', { isActive: true });
  });
  it('soft delete hides the manager and releases their teams', async () => {
    const gone = await t.manager('mgr.gone');
    const team = (await t.call('/admin/teams', 'POST', { name: 'Gone Team', managerId: gone.id })).body;
    assert.equal(team.manager.id, gone.id);
    assert.equal((await t.call(`/admin/managers/${gone.id}`, 'DELETE')).status, 200);
    assert.equal((await t.call(`/admin/managers/${gone.id}`)).status, 404);
    assert.equal((await t.call(`/admin/teams/${team.id}`)).body.manager, null);
  });
});

describe('teams are led by a manager', () => {
  it('create/update with a manager; invalid managers are refused; list by manager; details list managed teams', async () => {
    const m = await t.manager('team.mgr');
    const e = await t.exec('team.sales');
    const off = await t.manager('team.off');
    await t.call(`/admin/managers/${off.id}/status`, 'PATCH', { isActive: false });

    const team = (await t.call('/admin/teams', 'POST', { name: 'Led Team', managerId: m.id })).body;
    assert.deepEqual(team.manager, { id: m.id, name: 'Team.mgr' });
    assert.equal((await t.call('/admin/teams', 'POST', { name: 'Bad 1', managerId: e.id })).status, 400, 'a sales user is not a manager');
    assert.equal((await t.call('/admin/teams', 'POST', { name: 'Bad 2', managerId: ZERO })).status, 400);
    assert.equal((await t.call('/admin/teams', 'POST', { name: 'Bad 3', managerId: off.id })).status, 409, 'inactive manager');

    const plain = (await t.call('/admin/teams', 'POST', { name: 'Plain Team' })).body;
    assert.equal(plain.manager, null);
    assert.equal((await t.call(`/admin/teams/${plain.id}`, 'PATCH', { managerId: m.id })).body.manager.id, m.id);
    assert.equal((await t.call(`/admin/teams/${plain.id}`, 'PATCH', { managerId: null })).body.manager, null);
    assert.deepEqual((await t.call(`/admin/teams?managerId=${m.id}`)).body.map((x: any) => x.id), [team.id]);
    assert.deepEqual((await t.call(`/admin/managers/${m.id}`)).body.managedTeams.map((x: any) => x.id), [team.id]);
    // a manager is never a team member
    assert.equal((await t.call(`/admin/executives/${m.id}/team`, 'PATCH', { teamId: team.id })).status, 400);
  });
});

describe('login: own username and password, one portal per role', () => {
  it('email OR username works on every portal; the wrong portal gets the generic 401', async () => {
    await t.manager('login.m');
    await t.exec('login.s');
    for (const [portal, user] of [['manager', 'login.m'], ['executive', 'login.s'], ['admin', 'admin']] as const) {
      const pass = portal === 'admin' ? 'Admin-pass-123' : 'TempPass123';
      const byUsername = await t.asToken('')(`/auth/${portal}/login`, 'POST', { username: user, password: pass });
      assert.equal(byUsername.status, 200, `${portal} by username`);
      const byEmail = await t.asToken('')(`/auth/${portal}/login`, 'POST', { email: `${user}@test.com`, password: pass });
      assert.equal(byEmail.status, 200, `${portal} by email`);
    }
    const wrong = await t.asToken('')('/auth/executive/login', 'POST', { username: 'login.m', password: 'TempPass123' });
    assert.equal(wrong.status, 401);
    assert.equal((await t.asToken('')('/auth/manager/login', 'POST', { username: 'login.s', password: 'TempPass123' })).status, 401);
    assert.equal((await t.asToken('')('/auth/manager/login', 'POST', { password: 'x' })).status, 400, 'email or username required');
    assert.equal((await t.asToken('')('/auth/manager/login', 'POST', { username: 'nobody', password: 'x' })).status, 401);
  });
  it('role separation: each token only works in its own area', async () => {
    const mTok = t.asToken(await t.login('manager', 'login.m@test.com', 'TempPass123'));
    const sTok = t.asToken(await t.login('executive', 'login.s@test.com', 'TempPass123'));
    for (const path of ['/admin/leads', '/admin/managers', '/admin/executives', '/executive/leads']) assert.equal((await mTok(path)).status, 403, `manager ${path}`);
    assert.equal((await mTok('/manager/leads')).status, 200);
    for (const path of ['/manager/leads', '/manager/teams', '/manager/executives', '/admin/leads']) assert.equal((await sTok(path)).status, 403, `sales ${path}`);
    for (const path of ['/manager/leads', '/executive/leads']) assert.equal((await t.call(path)).status, 403, `admin ${path}`);
    assert.equal((await t.asToken('')('/manager/leads')).status, 401);
  });
});

describe('lead assignment by admin and manager', () => {
  let mA: any, mB: any, a1: any, a2: any, b1: any, em: any;
  let callMA: ReturnType<typeof t.asToken>, callMB: ReturnType<typeof t.asToken>;
  let callA1: ReturnType<typeof t.asToken>, callA2: ReturnType<typeof t.asToken>, callEM: ReturnType<typeof t.asToken>;
  let prop: any, open: any;

  const lead = (extra: object = {}) =>
    t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, propertyName: 'Assign Towers', source: '99ACRES', ...extra });
  const historyOf = async (leadId: string) =>
    (await pool.query('SELECT method, assigned_by_id, executive_id FROM property_assignment_history WHERE lead_id = $1 ORDER BY created_at', [leadId])).rows;

  before(async () => {
    mA = await t.manager('asg.ma');
    mB = await t.manager('asg.mb');
    const teamA = (await t.call('/admin/teams', 'POST', { name: 'Team A', managerId: mA.id })).body;
    const teamB = (await t.call('/admin/teams', 'POST', { name: 'Team B', managerId: mB.id })).body;
    a1 = await t.exec('asg.a1', teamA.id);
    a2 = await t.exec('asg.a2', teamA.id);
    em = await t.exec('asg.em', teamA.id, 'EXECUTIVE_MANAGER');
    b1 = await t.exec('asg.b1', teamB.id);
    prop = await t.property('Assign Towers', [a1.id]);
    open = await t.property('Open Plaza'); // no executives: its leads are pending
    callMA = t.asToken(await t.login('manager', 'asg.ma@test.com', 'TempPass123'));
    callMB = t.asToken(await t.login('manager', 'asg.mb@test.com', 'TempPass123'));
    callA1 = t.asToken(await t.login('executive', 'asg.a1@test.com', 'TempPass123'));
    callA2 = t.asToken(await t.login('executive', 'asg.a2@test.com', 'TempPass123'));
    callEM = t.asToken(await t.login('executive', 'asg.em@test.com', 'TempPass123'));
  });

  it('round-robin is unchanged: the property executives still get leads automatically', async () => {
    const l = await lead();
    assert.equal(l.body.assignedExecutive.id, a1.id);
    assert.deepEqual((await historyOf(l.body.id)).map((h) => [h.method, h.assigned_by_id]), [['ROUND_ROBIN', null]]);
  });

  it('admin assigns a lead to any sales executive; it is new for them and recorded as MANUAL', async () => {
    const l = (await lead()).body;
    const r = await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: b1.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.assignedExecutive.id, b1.id);
    assert.equal(r.body.isNew, true);
    const h = await historyOf(l.id);
    assert.deepEqual(h.map((x) => x.method), ['ROUND_ROBIN', 'MANUAL']);
    assert.equal(h[1].executive_id, b1.id);
    const hist = (await t.call(`/admin/properties/${prop.id}/assignment-history`)).body.history;
    assert.ok(hist.some((x: any) => x.leadId === l.id && x.method === 'MANUAL' && x.assignedBy.name === 'Admin'));
  });

  it('admin can assign a pending lead: it leaves PENDING_ASSIGNMENT and starts at INCOMING', async () => {
    const l = (await lead({ propertyName: open.name })).body;
    assert.equal(l.status, 'PENDING_ASSIGNMENT');
    const r = await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: a2.id });
    assert.equal(r.body.status, 'INCOMING');
    assert.equal(r.body.assignedExecutive.id, a2.id);
  });

  it('validation: executive must exist, be active and be a sales user; unknown fields rejected', async () => {
    const l = (await lead()).body;
    const adminId = (await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1")).rows[0].id;
    const go = (body: unknown) => t.call(`/admin/leads/${l.id}/assign`, 'PATCH', body);
    assert.equal((await go({ executiveId: ZERO })).status, 400);
    assert.equal((await go({ executiveId: adminId })).status, 400, 'admin is not assignable');
    assert.equal((await go({ executiveId: mA.id })).status, 400, 'a manager is not assignable');
    assert.equal((await go({ executiveId: 'x' })).status, 400);
    assert.equal((await go({})).status, 400);
    assert.equal((await go({ executiveId: a1.id, extra: 1 })).status, 400);
    await t.setActive(a2.id, false);
    assert.equal((await go({ executiveId: a2.id })).status, 409);
    await t.setActive(a2.id, true);
    assert.equal((await t.call(`/admin/leads/${ZERO}/assign`, 'PATCH', { executiveId: a1.id })).status, 404);
  });

  it('assigning to the executive who already has it changes nothing', async () => {
    const l = (await lead()).body;
    const before = (await historyOf(l.id)).length;
    const r = await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: l.assignedExecutive.id });
    assert.equal(r.status, 200);
    assert.equal((await historyOf(l.id)).length, before);
  });

  it('manager sees only their teams\' leads plus unassigned ones', async () => {
    const mine = (await lead()).body; // a1 (team A)
    const theirs = (await lead()).body;
    await t.call(`/admin/leads/${theirs.id}/assign`, 'PATCH', { executiveId: b1.id }); // team B
    const pending = (await lead({ propertyName: open.name })).body;

    const ids = (await callMA('/manager/leads?limit=200')).body.map((l: any) => l.id);
    assert.ok(ids.includes(mine.id) && ids.includes(pending.id));
    assert.ok(!ids.includes(theirs.id), "another manager's team lead is not visible");
    assert.ok((await callMB('/manager/leads?limit=200')).body.some((l: any) => l.id === theirs.id));
    assert.equal((await callMA(`/manager/leads/${theirs.id}`)).status, 404);
    assert.equal((await callMA(`/manager/leads/${mine.id}`)).status, 200);
    assert.equal((await callMA('/manager/leads?status=PENDING_ASSIGNMENT&limit=200')).body.every((l: any) => l.status === 'PENDING_ASSIGNMENT'), true);
  });

  it('manager lead detail includes the client history and does not clear the executive\'s New flag', async () => {
    const mobile = '9811122233';
    await lead({ mobile });
    const second = (await lead({ mobile })).body;
    const d = await callMA(`/manager/leads/${second.id}`);
    assert.equal(d.body.customerEnquiryCount, 2);
    assert.equal(d.body.customerHistory.length, 1);
    assert.equal((await callA1(`/executive/leads?isNew=true&limit=200`)).body.some((l: any) => l.id === second.id), true);
  });

  it('manager assigns within their own team only', async () => {
    const l = (await lead({ propertyName: open.name })).body; // pending
    const own = await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a2.id });
    assert.equal(own.status, 200);
    assert.equal(own.body.assignedExecutive.id, a2.id);
    assert.equal(own.body.status, 'INCOMING');

    const other = (await lead({ propertyName: open.name })).body;
    const cross = await callMA(`/manager/leads/${other.id}/assign`, 'PATCH', { executiveId: b1.id });
    assert.equal(cross.status, 403, "not an executive of the manager's teams");
    assert.equal((await t.call(`/admin/leads/${other.id}`)).body.assignedExecutive, null, 'nothing changed');

    const unplaced = await t.exec('asg.nomember'); // no team at all
    assert.equal((await callMA(`/manager/leads/${other.id}/assign`, 'PATCH', { executiveId: unplaced.id })).status, 403);
    assert.equal((await callMA(`/manager/leads/${other.id}/assign`, 'PATCH', { executiveId: mA.id })).status, 400);
  });

  it('manager cannot touch a lead of another manager\'s team (404, like it does not exist)', async () => {
    const l = (await lead()).body;
    await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: b1.id });
    assert.equal((await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a1.id })).status, 404);
    assert.equal((await callMB(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: b1.id })).status, 200);
  });

  it('reassignment keeps the pipeline status, resets "new" for the new executive and moves the lead', async () => {
    const l = (await lead()).body; // a1
    await callA1(`/executive/leads/${l.id}`); // opened
    await callA1(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' });
    const r = await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a2.id });
    assert.equal(r.body.status, 'CONNECTED', 'status kept');
    assert.equal(r.body.isNew, true);
    assert.equal((await callA1(`/executive/leads/${l.id}`)).status, 404, 'old executive no longer has it');
    const mine = await callA2(`/executive/leads/${l.id}`);
    assert.equal(mine.status, 200);
    assert.deepEqual((await historyOf(l.id)).map((h) => h.method), ['ROUND_ROBIN', 'MANUAL']);
  });

  it('manual assignment does not disturb the round-robin rotation', async () => {
    const rr = await t.property('Rotation Heights', [a1.id, a2.id]);
    const first = (await lead({ propertyName: rr.name })).body;
    assert.equal(first.assignedExecutive.id, a1.id);
    const manual = (await lead({ propertyName: rr.name })).body; // a2 by rotation
    await t.call(`/admin/leads/${manual.id}/assign`, 'PATCH', { executiveId: b1.id });
    const next = (await lead({ propertyName: rr.name })).body;
    assert.equal(next.assignedExecutive.id, a1.id, 'rotation continues a1 -> a2 -> a1');
  });

  it('an executive manager receives and works leads exactly like a sales executive', async () => {
    const l = (await lead({ propertyName: open.name })).body;
    const r = await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: em.id });
    assert.equal(r.body.assignedExecutive.id, em.id);
    assert.equal((await callEM('/executive/leads/summary')).body.newLeads >= 1, true);
    const opened = await callEM(`/executive/leads/${l.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.isNew, false);
    assert.equal((await callEM(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' })).body.status, 'RINGING');
    // and can be picked for round-robin on a property
    const p = await t.property('EM Property', [em.id, a1.id]);
    const got = new Set<string>();
    for (let i = 0; i < 2; i++) got.add((await lead({ propertyName: p.name })).body.assignedExecutive.id);
    assert.deepEqual([...got].sort(), [a1.id, em.id].sort());
  });

  it('manager portal: own teams and the executives in them', async () => {
    assert.deepEqual((await callMA('/manager/teams')).body.map((x: any) => x.name), ['Team A']);
    const names = (await callMA('/manager/executives')).body.map((x: any) => x.username).sort();
    assert.deepEqual(names, ['asg.a1', 'asg.a2', 'asg.em']);
    assert.ok((await callMA('/manager/executives')).body.every((x: any) => x.role === 'SALES'));
    assert.deepEqual((await callMB('/manager/executives')).body.map((x: any) => x.username), ['asg.b1']);
  });
});
