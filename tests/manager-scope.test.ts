import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mA: any, mB: any, a1: any, a2: any, b1: any, loose: any;
let callMA: ReturnType<typeof t.asToken>, callMB: ReturnType<typeof t.asToken>, callA1: ReturnType<typeof t.asToken>;

const pool_ = async (propertyId: string) =>
  (await pool.query('SELECT executive_id FROM property_executives WHERE property_id = $1', [propertyId])).rows.map((r) => r.executive_id).sort();
const lead = (propertyName: string) =>
  t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, propertyName, source: '99ACRES' });

before(async () => {
  t = await startTestApp();
  mA = await t.manager('sc.ma');
  mB = await t.manager('sc.mb');
  a1 = await t.exec('sc.a1', mA.id);
  a2 = await t.exec('sc.a2', mA.id);
  b1 = await t.exec('sc.b1', mB.id);
  loose = await t.exec('sc.loose'); // reports to nobody
  callMA = t.asToken(await t.login('manager', 'sc.ma@test.com', 'TempPass123'));
  callMB = t.asToken(await t.login('manager', 'sc.mb@test.com', 'TempPass123'));
  callA1 = t.asToken(await t.login('executive', 'sc.a1@test.com', 'TempPass123'));
});
after(() => t.close());

describe('the teams feature is gone', () => {
  it('no team route is registered, and no team table or column is left', async () => {
    for (const [path, method] of [['/admin/teams', 'GET'], ['/admin/teams', 'POST'], [`/admin/teams/${ZERO}`, 'GET'], [`/admin/executives/${a1.id}/team`, 'PATCH']] as const) {
      assert.equal((await t.call(path, method, method === 'GET' ? undefined : {})).status, 404, `${method} ${path}`);
    }
    assert.equal((await callMA('/manager/teams')).status, 404);
    const { rows } = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'teams'
       UNION ALL SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'team_id'`,
    );
    assert.equal(rows.length, 0);
  });
  it('teamId is rejected when creating an executive', async () => {
    const r = await t.call('/admin/executives', 'POST', { name: 'T', email: 't@test.com', username: 'sc.t', password: 'TempPass123', teamId: ZERO });
    assert.equal(r.status, 400);
  });
});

describe('manager scope over executives', () => {
  it('a manager lists and opens only their own executives', async () => {
    assert.deepEqual((await callMA('/manager/executives')).body.map((e: any) => e.username), ['sc.a1', 'sc.a2']);
    assert.deepEqual((await callMB('/manager/executives')).body.map((e: any) => e.username), ['sc.b1']);
    assert.equal((await callMA(`/manager/executives/${a1.id}`)).status, 200);
    assert.equal((await callMA(`/manager/executives/${b1.id}`)).status, 404, "another manager's executive");
    assert.equal((await callMA(`/manager/executives/${loose.id}`)).status, 404, 'unmanaged executive');
    assert.equal((await callMA(`/manager/executives/${mB.id}`)).status, 400, 'a manager is not an executive');
  });
  it('an executive cannot reach the manager or admin APIs', async () => {
    for (const path of ['/manager/executives', '/manager/properties', '/admin/executives', '/admin/managers']) {
      assert.equal((await callA1(path)).status, 403, path);
    }
  });
});

describe('manager edits the property rotation pool', () => {
  let p: any;
  before(async () => { p = await t.property('Scope Towers', [a1.id, b1.id, loose.id]); });

  it('a manager only sets THEIR part of the list; other executives stay', async () => {
    const r = await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [a2.id] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(await pool_(p.id), [a2.id, b1.id, loose.id].sort(), "a1 (theirs) replaced by a2; b1 and the unmanaged one untouched");
    // emptying their part keeps everyone else
    assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [] })).status, 200);
    assert.deepEqual(await pool_(p.id), [b1.id, loose.id].sort());
  });
  it('refuses executives that are not theirs (another manager\'s, unmanaged, or non-sales) and changes nothing', async () => {
    const before = await pool_(p.id);
    for (const id of [b1.id, loose.id]) {
      assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [a1.id, id] })).status, 403, id);
    }
    assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [mB.id] })).status, 400);
    assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [ZERO] })).status, 400);
    assert.equal((await callMA(`/manager/properties/${ZERO}/executives`, 'PUT', { executiveIds: [a1.id] })).status, 404);
    assert.deepEqual(await pool_(p.id), before);
  });
  it('an inactive executive of theirs is refused, but an inactive one already on the list does not block an edit', async () => {
    await t.setActive(b1.id, false); // b1 is on the list and belongs to manager B
    assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [a1.id] })).status, 200);
    assert.ok((await pool_(p.id)).includes(b1.id), "other manager's (inactive) executive is preserved");
    await t.setActive(a2.id, false);
    assert.equal((await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [a2.id] })).status, 409);
    await t.setActive(a2.id, true);
    await t.setActive(b1.id, true);
  });
  it('admin can still set the whole list, including anyone', async () => {
    assert.equal((await t.call(`/admin/properties/${p.id}/executives`, 'PUT', { executiveIds: [a1.id, b1.id, loose.id] })).status, 200);
    assert.deepEqual(await pool_(p.id), [a1.id, b1.id, loose.id].sort());
  });
  it('managers can read properties', async () => {
    assert.ok((await callMA('/manager/properties')).body.some((x: any) => x.id === p.id));
    assert.equal((await callMA(`/manager/properties/${p.id}`)).status, 200);
  });
});

describe('round robin and pending leads without teams', () => {
  it('rotates over the property\'s own list whatever managers its executives report to', async () => {
    const p = await t.property('Mixed Heights', [a1.id, b1.id, a2.id]);
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await lead(p.name)).body.assignedExecutive.id);
    assert.deepEqual(got, [a1.id, a2.id, b1.id, a1.id].map((x) => x), 'stable created_at order, wrapping around');
  });
  it('the manager editing the pool triggers assignment of waiting leads', async () => {
    const p = await t.property('Waiting Wharf');
    const l = (await lead(p.name)).body;
    assert.equal(l.status, 'PENDING_ASSIGNMENT');
    const r = await callMA(`/manager/properties/${p.id}/executives`, 'PUT', { executiveIds: [a1.id] });
    assert.equal(r.body.assignedPendingLeads, 1);
    assert.equal((await t.call(`/admin/leads/${l.id}`)).body.assignedExecutive.id, a1.id);
  });
  it('with no eligible executive the lead stays PENDING_ASSIGNMENT and only the right manager can assign it by hand', async () => {
    const p = await t.property('Idle Isle', [a2.id]);
    await t.setActive(a2.id, false);
    const l = (await lead(p.name)).body;
    assert.equal(l.status, 'PENDING_ASSIGNMENT');
    await t.setActive(a2.id, true);
    assert.equal((await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: b1.id })).status, 403, "another manager's executive");
    assert.equal((await callMB(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a1.id })).status, 403);
    assert.equal((await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a1.id })).status, 200);
    assert.equal((await callMB(`/manager/leads/${l.id}`)).status, 404, 'now assigned to A\'s executive: gone from B\'s view');
  });
  it('an unmanaged executive can only receive leads from the admin or round robin', async () => {
    const p = await t.property('Loose Lane', [a1.id]);
    const l = (await lead(p.name)).body;
    assert.equal((await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: loose.id })).status, 403);
    assert.equal((await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: loose.id })).status, 200);
  });
});
