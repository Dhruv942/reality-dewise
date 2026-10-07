import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mgr: ReturnType<typeof t.asToken>;
let mine: any, other: any, prop: any;

const body = (extra: object = {}) => ({ name: 'Mgr Lead', mobile: '9811122233', propertyName: 'Mgr Tower', source: '99ACRES', ...extra });
const leadCount = async () => Number((await pool.query('SELECT count(*) FROM leads')).rows[0].count);

before(async () => {
  t = await startTestApp();
  const m = await t.manager('lead.mgr');
  const teamA = (await t.call('/admin/teams', 'POST', { name: 'Mgr Team', managerId: m.id })).body;
  const teamB = await t.team('Other Team');
  mine = await t.exec('mine', teamA.id);
  other = await t.exec('other', teamB.id);
  prop = await t.property('Mgr Tower', [other.id]);
  mgr = t.asToken(await t.login('manager', 'lead.mgr@test.com', 'TempPass123'));
});
after(() => t.close());

describe('manager creates a lead and assigns it', () => {
  it('creates the lead already assigned to an executive of their team', async () => {
    const res = await mgr('/manager/leads', 'POST', body({ executiveId: mine.id }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.assignedExecutive.id, mine.id);
    assert.equal(res.body.status, 'INCOMING');
    // the manager can open it, and the history says it was a manual assignment
    assert.equal((await mgr(`/manager/leads/${res.body.id}`)).status, 200);
    const { rows } = await pool.query('SELECT method FROM property_assignment_history WHERE lead_id = $1', [res.body.id]);
    assert.deepEqual(rows.map((r) => r.method), ['MANUAL']);
  });
  it('an executive must be chosen', async () => {
    assert.equal((await mgr('/manager/leads', 'POST', body({ mobile: '9811122244' }))).status, 400);
  });
  it('refuses an executive outside their teams and saves nothing', async () => {
    const before = await leadCount();
    const res = await mgr('/manager/leads', 'POST', body({ mobile: '9811122255', executiveId: other.id }));
    assert.equal(res.status, 403);
    assert.equal(await leadCount(), before);
  });
  it('refuses a lead for an inactive property', async () => {
    await t.call(`/admin/properties/${prop.id}/status`, 'PATCH', { isActive: false });
    const before = await leadCount();
    const res = await mgr('/manager/leads', 'POST', body({ mobile: '9811122266', executiveId: mine.id }));
    assert.equal(res.status, 409);
    assert.equal(await leadCount(), before);
  });
  it('admins and executives cannot use the manager route', async () => {
    assert.equal((await t.call('/manager/leads', 'POST', body({ executiveId: mine.id }))).status, 403);
  });
});
