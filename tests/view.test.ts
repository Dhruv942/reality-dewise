import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mA: any, mB: any, a1: any, a2: any, b1: any, loose: any;
let callMA: ReturnType<typeof t.asToken>, callMB: ReturnType<typeof t.asToken>, callA1: ReturnType<typeof t.asToken>;
let tokMA: string;
let prop: any;

const lead = (propertyName: string) =>
  t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, propertyName, source: '99ACRES' });
const leadsOf = (r: any) => r.body.recentLeads.map((l: any) => l.id);

before(async () => {
  t = await startTestApp();
  mA = await t.manager('vw.ma');
  mB = await t.manager('vw.mb');
  a1 = await t.exec('vw.a1', mA.id);
  a2 = await t.exec('vw.a2', mA.id);
  b1 = await t.exec('vw.b1', mB.id);
  loose = await t.exec('vw.loose');
  prop = await t.property('View Towers', [a1.id]);
  tokMA = await t.login('manager', 'vw.ma@test.com', 'TempPass123');
  callMA = t.asToken(tokMA);
  callMB = t.asToken(await t.login('manager', 'vw.mb@test.com', 'TempPass123'));
  callA1 = t.asToken(await t.login('executive', 'vw.a1@test.com', 'TempPass123'));
});
after(() => t.close());

describe('admin switches dashboards', () => {
  it('lists every manager and every executive to switch to', async () => {
    assert.deepEqual((await t.call('/view/managers')).body.map((m: any) => m.username), ['vw.ma', 'vw.mb']);
    assert.deepEqual((await t.call('/view/executives')).body.map((e: any) => e.username), ['vw.a1', 'vw.a2', 'vw.b1', 'vw.loose']);
    assert.deepEqual((await t.call(`/view/executives?managerId=${mB.id}`)).body.map((e: any) => e.username), ['vw.b1']);
  });
  it('opens any executive\'s dashboard: their summary and their latest leads', async () => {
    const l = (await lead(prop.name)).body; // round robin -> a1
    const r = await t.call(`/view/executives/${a1.id}/dashboard`);
    assert.equal(r.status, 200);
    assert.equal(r.body.readOnly, true);
    assert.deepEqual([r.body.viewing.role, r.body.viewing.user.username], ['SALES', 'vw.a1']);
    assert.ok(leadsOf(r).includes(l.id));
    assert.equal(r.body.summary.totalLeads >= 1, true);
    assert.equal((await t.call(`/view/executives/${loose.id}/dashboard`)).status, 200);
  });
  it('opens a manager\'s dashboard: their executives and their lead scope (own executives\' leads + pending)', async () => {
    const theirs = (await lead(prop.name)).body; // a1 (manager A)
    await t.call(`/admin/leads/${theirs.id}/assign`, 'PATCH', { executiveId: b1.id }); // now manager B's
    const open = await t.property('View Pending');
    const pending = (await lead(open.name)).body;
    const r = await t.call(`/view/managers/${mA.id}/dashboard`);
    assert.equal(r.status, 200);
    assert.equal(r.body.viewing.role, 'MANAGER');
    assert.deepEqual(r.body.executives.map((e: any) => e.username), ['vw.a1', 'vw.a2']);
    assert.ok(leadsOf(r).includes(pending.id), 'pending leads are in a manager\'s scope');
    assert.ok(!leadsOf(r).includes(theirs.id), "another manager's executive's lead is not");
    assert.equal(r.body.summary.pendingLeads >= 1, true);
  });
  it('unknown / wrong-kind ids are 404, bad ids 400', async () => {
    assert.equal((await t.call(`/view/executives/${ZERO}/dashboard`)).status, 404);
    assert.equal((await t.call(`/view/executives/${mA.id}/dashboard`)).status, 404, 'a manager is not an executive');
    assert.equal((await t.call(`/view/managers/${a1.id}/dashboard`)).status, 404, 'an executive is not a manager');
    assert.equal((await t.call(`/view/managers/${ZERO}/dashboard`)).status, 404);
    assert.equal((await t.call('/view/executives/not-a-uuid/dashboard')).status, 400);
  });
  it('a deleted executive can no longer be viewed', async () => {
    const gone = await t.exec('vw.gone', mA.id);
    await t.call(`/admin/executives/${gone.id}`, 'DELETE');
    assert.equal((await t.call(`/view/executives/${gone.id}/dashboard`)).status, 404);
  });
});

describe('manager switches only to their own executives', () => {
  it('sees only their executives in the switcher, whatever managerId they ask for', async () => {
    assert.deepEqual((await callMA('/view/executives')).body.map((e: any) => e.username), ['vw.a1', 'vw.a2']);
    assert.deepEqual((await callMA(`/view/executives?managerId=${mB.id}`)).body.map((e: any) => e.username), ['vw.a1', 'vw.a2']);
    assert.deepEqual((await callMB('/view/executives')).body.map((e: any) => e.username), ['vw.b1']);
  });
  it('opens their executive\'s dashboard, but another manager\'s or an unmanaged executive looks like "not found"', async () => {
    assert.equal((await callMA(`/view/executives/${a1.id}/dashboard`)).status, 200);
    assert.equal((await callMA(`/view/executives/${b1.id}/dashboard`)).status, 404);
    assert.equal((await callMA(`/view/executives/${loose.id}/dashboard`)).status, 404);
    assert.equal((await callMB(`/view/executives/${a1.id}/dashboard`)).status, 404);
  });
  it('cannot look at manager dashboards or the manager list', async () => {
    assert.equal((await callMA('/view/managers')).status, 403);
    assert.equal((await callMA(`/view/managers/${mA.id}/dashboard`)).status, 403);
    assert.equal((await callMA(`/view/managers/${mB.id}/dashboard`)).status, 403);
  });
});

describe('an executive cannot switch, and viewing is not acting', () => {
  it('executives are refused everywhere under /view and unauthenticated calls get 401', async () => {
    for (const p of ['/view/executives', `/view/executives/${a1.id}/dashboard`, '/view/managers', `/view/managers/${mA.id}/dashboard`]) {
      assert.equal((await callA1(p)).status, 403, p);
      assert.equal((await t.asToken('')(p)).status, 401, p);
    }
  });
  it('the view endpoints are GET only', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      assert.equal((await t.call(`/view/executives/${a1.id}/dashboard`, method, {})).status, 404, method);
    }
  });
  it('switching never changes the caller\'s role or token: they stay a manager/admin with the same permissions', async () => {
    await callMA(`/view/executives/${a1.id}/dashboard`);
    assert.equal((await callMA('/auth/me')).body.role, 'MANAGER');
    assert.equal((await callMA('/executive/leads')).status, 403, 'viewing an executive does not make the manager an executive');
    const me = (await t.call('/auth/me')).body;
    await t.call(`/view/managers/${mA.id}/dashboard`);
    await t.call(`/view/executives/${a1.id}/dashboard`);
    assert.equal((await t.call('/auth/me')).body.role, 'ADMIN');
    assert.deepEqual((await t.call('/auth/me')).body, me);
    assert.equal((await pool.query("SELECT role FROM users WHERE id = $1", [mA.id])).rows[0].role, 'MANAGER');
  });
  it('viewing an executive does not clear their New flags (the viewer is not them)', async () => {
    const l = (await lead(prop.name)).body;
    const unseen = async () => (await pool.query('SELECT seen_at FROM leads WHERE id = $1', [l.id])).rows[0].seen_at;
    assert.equal(await unseen(), null);
    await t.call(`/view/executives/${l.assignedExecutive.id}/dashboard`);
    await callMA(`/view/executives/${l.assignedExecutive.id}/dashboard`).catch(() => {});
    assert.equal(await unseen(), null);
  });
  it('a manager still cannot act outside their scope while viewing: other managers\' leads and properties stay blocked', async () => {
    const l = (await lead(prop.name)).body;
    await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: b1.id });
    assert.equal((await callMA(`/manager/leads/${l.id}`)).status, 404);
    assert.equal((await callMA(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: a1.id })).status, 404);
    assert.equal((await callMA(`/manager/properties/${prop.id}/executives`, 'PUT', { executiveIds: [b1.id] })).status, 403);
  });
});
