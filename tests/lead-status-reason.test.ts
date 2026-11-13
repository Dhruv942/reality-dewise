import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let executive: any;
let executiveCall: ReturnType<typeof t.asToken>;
let property: any;

before(async () => {
  t = await startTestApp();
  executive = await t.exec('reason-exec');
  executiveCall = t.asToken(await t.login('executive', 'reason-exec@test.com', 'TempPass123'));
  property = await t.property('Reason Towers', [executive.id]);
});

after(() => t.close());

const createLead = (mobile: string) =>
  t.call('/admin/leads', 'POST', {
    name: 'Reason Customer',
    mobile,
    propertyName: property.name,
    source: '99ACRES',
  });

describe('lead status reasons', () => {
  it('stores an INVALID reason and exposes it in detail and filtered lists', async () => {
    const lead = await createLead('9000001001');
    const updated = await executiveCall(`/executive/leads/${lead.body.id}/status`, 'PATCH', {
      status: 'INVALID',
      reason: 'NO_REQUIREMENT',
    });

    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.statusReason, { code: 'NO_REQUIREMENT', other: null });
    assert.equal((await executiveCall(`/executive/leads/${lead.body.id}`)).body.statusReason.code, 'NO_REQUIREMENT');
    const filtered = await t.call('/admin/leads?statusReason=NO_REQUIREMENT');
    assert.ok(filtered.body.some((item: any) => item.id === lead.body.id));
  });

  it('requires and stores a short custom reason for Others', async () => {
    const lead = await createLead('9000001002');
    const updated = await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', {
      status: 'LOST',
      reason: 'OTHER',
      otherReason: 'Client relocated',
    });

    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.statusReason, { code: 'OTHER', other: 'Client relocated' });
    assert.equal((await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', { status: 'LOST', reason: 'OTHER' })).status, 400);
    assert.equal((await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', { status: 'LOST', reason: 'OTHER', otherReason: 'This reason is definitely too long' })).status, 400);
  });

  it('rejects a reason from the wrong status family and clears the reason on a normal status', async () => {
    const lead = await createLead('9000001003');
    assert.equal((await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', { status: 'INVALID', reason: 'BUDGET_ISSUE' })).status, 400);
    await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', { status: 'INVALID', reason: 'NOT_ABLE_TO_CONNECT' });
    const normal = await t.call(`/admin/leads/${lead.body.id}/status`, 'PATCH', { status: 'CONNECTED' });
    assert.equal(normal.status, 200);
    assert.equal(normal.body.statusReason, null);
  });
});
