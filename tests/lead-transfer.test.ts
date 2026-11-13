import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, ZERO } from './helpers';
import { pool } from '../src/database/pool';

let t: Awaited<ReturnType<typeof startTestApp>>;
let admin: typeof t.call;
let managerA: ReturnType<typeof t.asToken>;
let managerB: ReturnType<typeof t.asToken>;
let executiveA: { id: string };
let executiveB: { id: string };
let executiveOther: { id: string };
let lead: { id: string };

before(async () => {
  t = await startTestApp();
  const managerAUser = await t.manager('transfer.manager.a');
  const managerBUser = await t.manager('transfer.manager.b');
  executiveA = await t.exec('transfer.exec.a', managerAUser.id);
  executiveB = await t.exec('transfer.exec.b', managerAUser.id);
  executiveOther = await t.exec('transfer.exec.other', managerBUser.id);
  admin = t.call;
  managerA = t.asToken(await t.login('manager', 'transfer.manager.a@test.com', 'TempPass123'));
  managerB = t.asToken(await t.login('manager', 'transfer.manager.b@test.com', 'TempPass123'));
  const property = await t.property('Transfer House', [executiveA.id, executiveB.id, executiveOther.id]);
  lead = (await admin('/admin/leads', 'POST', {
    name: 'Transfer Customer',
    mobile: '9876543210',
    propertyName: property.name,
    source: '99ACRES',
    requirement: '3 BHK',
  })).body;
});

after(() => t.close());

describe('lead transfer', () => {
  it('admin transfers a lead and records the destination, actor, and reason', async () => {
    const response = await admin(`/admin/leads/${lead.id}/transfer`, 'POST', { targetExecutiveId: executiveB.id, reason: 'Workload balancing' });
    assert.equal(response.status, 200);
    assert.equal(response.body.assignedExecutive.id, executiveB.id);
    assert.equal(response.body.customer.name, 'Transfer Customer');

    const activity = (await admin(`/admin/leads/${lead.id}`)).body.activity;
    assert.ok(activity.some((entry: { type: string; message: string }) => entry.type === 'TRANSFERRED' && entry.message.includes('Workload balancing')));
    const history = (await pool.query('SELECT method, assigned_by_id, reason FROM property_assignment_history WHERE lead_id = $1 ORDER BY created_at DESC', [lead.id])).rows;
    assert.equal(history[0].method, 'TRANSFER');
    assert.equal(history[0].assigned_by_id, (await pool.query("SELECT id FROM users WHERE email = 'admin@test.com'")).rows[0].id);
    assert.equal(history[0].reason, 'Workload balancing');
  });

  it('manager can transfer within scope but not to another manager executive', async () => {
    const managerLead = await managerA('/manager/leads', 'POST', {
      name: 'Manager Transfer Customer',
      mobile: '9876543211',
      propertyName: 'Manager Transfer House',
      source: '99ACRES',
      executiveId: executiveA.id,
    });
    assert.equal(managerLead.status, 201);
    const own = await managerA(`/manager/leads/${managerLead.body.id}/transfer`, 'POST', { targetExecutiveId: executiveB.id });
    assert.equal(own.status, 200);
    const cross = await managerA(`/manager/leads/${managerLead.body.id}/transfer`, 'POST', { targetExecutiveId: executiveOther.id });
    assert.equal(cross.status, 403);
  });

  it('rejects malformed targets and inactive executives', async () => {
    assert.equal((await admin(`/admin/leads/${lead.id}/transfer`, 'POST', { targetExecutiveId: ZERO.slice(0, 8) })).status, 400);
    assert.equal((await admin(`/admin/leads/${lead.id}/transfer`, 'POST', { targetExecutiveId: ZERO })).status, 400);
    await admin(`/admin/executives/${executiveB.id}/status`, 'PATCH', { isActive: false });
    assert.equal((await admin(`/admin/leads/${lead.id}/transfer`, 'POST', { targetExecutiveId: executiveB.id })).status, 409);
  });

  it('does not allow a sales executive to transfer', async () => {
    const sales = t.asToken(await t.login('executive', 'transfer.exec.a@test.com', 'TempPass123'));
    assert.equal((await sales(`/leads/${lead.id}/transfer`, 'POST', { targetExecutiveId: executiveB.id })).status, 404);
  });
});
