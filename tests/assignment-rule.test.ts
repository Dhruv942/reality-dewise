import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mgrCall: ReturnType<typeof t.asToken>, salesCall: ReturnType<typeof t.asToken>;
let a: any, b: any, c: any;
let n = 0;

const lead = (propertyName: string) =>
  t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `97${String(++n).padStart(8, '0')}`, propertyName, source: '99ACRES' });
const stored = async () => (await pool.query("SELECT value, updated_by_id FROM app_settings WHERE key = 'assignment_rule'")).rows;

before(async () => {
  t = await startTestApp();
  const mgr = await t.manager('rule.mgr');
  a = await t.exec('rule.a');
  b = await t.exec('rule.b');
  c = await t.exec('rule.c');
  mgrCall = t.asToken(await t.login('manager', 'rule.mgr@test.com', 'TempPass123'));
  salesCall = t.asToken(await t.login('executive', 'rule.a@test.com', 'TempPass123'));
  void mgr;
});
after(() => t.close());

describe('assignment rule: round robin is the default', () => {
  it('with nothing stored the effective rule is ROUND_ROBIN and the API says so', async () => {
    await pool.query("DELETE FROM app_settings WHERE key = 'assignment_rule'");
    const r = await t.call('/admin/settings/assignment-rule');
    assert.equal(r.status, 200);
    assert.equal(r.body.rule, 'ROUND_ROBIN');
    assert.equal(r.body.defaultRule, 'ROUND_ROBIN');
    assert.equal(r.body.isDefault, true);
    assert.equal(r.body.updatedAt, null);
    assert.equal(r.body.updatedBy, null);
    assert.deepEqual(r.body.availableRules.map((x: any) => x.value), ['ROUND_ROBIN']);
    assert.ok(r.body.availableRules[0].label && r.body.availableRules[0].description);
  });

  it('assignment works on the default rule even though no setting row exists', async () => {
    const p = await t.property('Default Rule Towers', [a.id, b.id]);
    assert.deepEqual((await stored()).length, 0);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, a.id);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, b.id);
  });

  it('the database only accepts known rules', async () => {
    await assert.rejects(pool.query("INSERT INTO app_settings (key, value) VALUES ('assignment_rule', 'RANDOM')"), /app_settings_assignment_rule_check/);
    assert.equal((await stored()).length, 0);
  });
});

describe('assignment rule: only an admin can read or change it', () => {
  it('admin can set the rule: stored, attributed to the admin, returned by GET', async () => {
    const r = await t.call('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' });
    assert.equal(r.status, 200);
    assert.equal(r.body.rule, 'ROUND_ROBIN');
    assert.equal(r.body.updatedBy.name, 'Admin');
    assert.ok(r.body.updatedAt);
    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].value, 'ROUND_ROBIN');
    assert.equal(rows[0].updated_by_id, r.body.updatedBy.id);
    assert.deepEqual((await t.call('/admin/settings/assignment-rule')).body.updatedBy, r.body.updatedBy);
  });

  it('setting it again is fine and keeps a single row', async () => {
    assert.equal((await t.call('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' })).status, 200);
    assert.equal((await stored()).length, 1);
  });

  it('validation: unknown rule, wrong case, missing, wrong type, extra fields -> 400 and nothing changes', async () => {
    for (const body of [{ rule: 'RANDOM' }, { rule: 'round_robin' }, { rule: '' }, {}, { rule: 5 }, { rule: 'ROUND_ROBIN', extra: 1 }, { Rule: 'ROUND_ROBIN' }]) {
      const r = await t.call('/admin/settings/assignment-rule', 'PUT', body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await stored())[0].value, 'ROUND_ROBIN');
  });

  it('a manager cannot read or change it (403)', async () => {
    assert.equal((await mgrCall('/admin/settings/assignment-rule')).status, 403);
    assert.equal((await mgrCall('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' })).status, 403);
  });

  it('a sales executive / executive manager cannot read or change it (403)', async () => {
    assert.equal((await salesCall('/admin/settings/assignment-rule')).status, 403);
    assert.equal((await salesCall('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' })).status, 403);
  });

  it('no token is 401, and a refused change leaves the stored rule and its author untouched', async () => {
    const before = await stored();
    assert.equal((await t.asToken('')('/admin/settings/assignment-rule')).status, 401);
    assert.equal((await t.asToken('')('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' })).status, 401);
    await mgrCall('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' });
    assert.deepEqual(await stored(), before);
  });
});

describe('round robin under the configured rule', () => {
  it('leads go to the picked executives one after another and the rotation keeps going', async () => {
    const p = await t.property('Sequence Heights', [a.id, b.id, c.id]);
    const order: string[] = [];
    for (let i = 0; i < 7; i++) order.push((await lead(p.name)).body.assignedExecutive.id);
    assert.deepEqual(order, [a.id, b.id, c.id, a.id, b.id, c.id, a.id]);
    // changing (re-saving) the rule in the middle does not reset the position
    await t.call('/admin/settings/assignment-rule', 'PUT', { rule: 'ROUND_ROBIN' });
    assert.equal((await lead(p.name)).body.assignedExecutive.id, b.id);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, c.id);
  });

  it('a lead is assigned to exactly one executive', async () => {
    const p = await t.property('One Owner Plaza', [a.id, b.id]);
    const l = (await lead(p.name)).body;
    assert.equal((await pool.query('SELECT count(*)::int n FROM property_assignment_history WHERE lead_id = $1', [l.id])).rows[0].n, 1);
  });

  it('30 leads arriving at the same moment get 30 different positions: an even 10/10/10 split', async () => {
    const p = await t.property('Parallel Park', [a.id, b.id, c.id]);
    const rs = await Promise.all(Array.from({ length: 30 }, () => lead(p.name)));
    assert.ok(rs.every((r) => r.status === 201));
    for (const e of [a, b, c]) assert.equal(rs.filter((r) => r.body.assignedExecutive.id === e.id).length, 10);
    const { rows } = await pool.query('SELECT lead_id, count(*)::int n FROM property_assignment_history WHERE property_id = $1 GROUP BY lead_id', [p.id]);
    assert.equal(rows.length, 30);
    assert.ok(rows.every((r) => r.n === 1), 'no lead was assigned twice');
  });

  it('each property rotates on its own; other executives of other properties are not drawn in', async () => {
    const p1 = await t.property('Own Rotation One', [a.id, b.id]);
    const p2 = await t.property('Own Rotation Two', [b.id, c.id]);
    assert.equal((await lead(p1.name)).body.assignedExecutive.id, a.id);
    assert.equal((await lead(p2.name)).body.assignedExecutive.id, b.id);
    assert.equal((await lead(p1.name)).body.assignedExecutive.id, b.id);
    assert.equal((await lead(p2.name)).body.assignedExecutive.id, c.id);
  });

  it('inactive executives are skipped and rejoin the rotation', async () => {
    const p = await t.property('Skip Court', [a.id, b.id, c.id]);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, a.id);
    await t.setActive(b.id, false);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, c.id);
    await t.setActive(b.id, true);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, a.id);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, b.id);
  });
});

describe('pending assignment still works with the rule in place', () => {
  it('no executives -> PENDING_ASSIGNMENT; picking executives assigns the waiting leads in order and rotation continues', async () => {
    const p = await t.property('Pending Palms');
    const waiting = [(await lead(p.name)).body, (await lead(p.name)).body, (await lead(p.name)).body];
    assert.ok(waiting.every((l) => l.status === 'PENDING_ASSIGNMENT' && l.assignedExecutive === null));
    assert.match(waiting[0].notice, /No executive\/team is assigned to Pending Palms/);

    const r = await t.call(`/admin/properties/${p.id}/executives`, 'PUT', { executiveIds: [a.id, b.id] });
    assert.equal(r.body.assignedPendingLeads, 3);
    const after = await Promise.all(waiting.map(async (l) => (await t.call(`/admin/leads/${l.id}`)).body));
    assert.deepEqual(after.map((l) => l.assignedExecutive.id), [a.id, b.id, a.id]);
    assert.ok(after.every((l) => l.status === 'INCOMING'));
    assert.equal((await lead(p.name)).body.assignedExecutive.id, b.id, 'next lead continues the rotation');
  });

  it('a manual assignment by an admin does not move the rotation', async () => {
    const p = await t.property('Manual Meadows', [a.id, b.id]);
    assert.equal((await lead(p.name)).body.assignedExecutive.id, a.id);
    const second = (await lead(p.name)).body; // b by rotation
    await t.call(`/admin/leads/${second.id}/assign`, 'PATCH', { executiveId: c.id });
    assert.equal((await lead(p.name)).body.assignedExecutive.id, a.id);
  });
});
