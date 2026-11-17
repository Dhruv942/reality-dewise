import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let admin: ReturnType<typeof t.asToken>;
let executiveA: any;
let executiveB: any;
let manager: any;
let executiveACall: ReturnType<typeof t.asToken>;
let executiveBCall: ReturnType<typeof t.asToken>;
let managerCall: ReturnType<typeof t.asToken>;
let property: { id: string; name: string };
let lead: any;

const createLead = () => t.call('/admin/leads', 'POST', {
  name: 'History Customer',
  mobile: '9012345678',
  email: 'history@example.com',
  propertyName: property.name,
  source: '99ACRES',
  message: 'Initial enquiry',
});

before(async () => {
  t = await startTestApp();
  admin = t.asToken(await t.login('admin', 'admin@test.com', 'Admin-pass-123'));
  manager = await t.manager('history.manager');
  executiveA = await t.exec('history.exec.a', manager.id);
  executiveB = await t.exec('history.exec.b', manager.id);
  executiveACall = t.asToken(await t.login('executive', 'history.exec.a@test.com', 'TempPass123'));
  executiveBCall = t.asToken(await t.login('executive', 'history.exec.b@test.com', 'TempPass123'));
  managerCall = t.asToken(await t.login('manager', 'history.manager@test.com', 'TempPass123'));
  property = await t.property('History Heights', [executiveA.id]);
  lead = await createLead();
});

after(() => t.close());

describe('lead history and comments', () => {
  it('records comments with actor and exposes them in the lead activity timeline', async () => {
    const first = await executiveACall(`/executive/leads/${lead.body.id}/comments`, 'POST', { comment: 'Spoke with the customer about budget.' });
    assert.equal(first.status, 200);
    assert.ok(first.body.activity.some((entry: any) => entry.type === 'COMMENT_ADDED' && entry.message === 'Spoke with the customer about budget.' && entry.actor?.name === 'History.exec.a'));

    const managerComment = await managerCall(`/manager/leads/${lead.body.id}/comments`, 'POST', { comment: 'Manager reviewed the enquiry.' });
    assert.equal(managerComment.status, 200);
    assert.ok(managerComment.body.activity.some((entry: any) => entry.type === 'COMMENT_ADDED' && entry.message === 'Manager reviewed the enquiry.' && entry.actor?.name === 'History.manager'));

    const adminComment = await admin(`/admin/leads/${lead.body.id}/comments`, 'POST', { comment: 'Admin note for future follow-up.' });
    assert.equal(adminComment.status, 200);
    assert.ok(adminComment.body.activity.some((entry: any) => entry.type === 'COMMENT_ADDED' && entry.message === 'Admin note for future follow-up.' && entry.actor?.name === 'Admin'));
  });

  it('lets a previously assigned executive read the full history after reassignment but not change the lead', async () => {
    const moved = await admin(`/admin/leads/${lead.body.id}/transfer`, 'POST', { targetExecutiveId: executiveB.id, reason: 'Coverage change' });
    assert.equal(moved.status, 200);

    const oldOwner = await executiveACall(`/executive/leads/${lead.body.id}`);
    assert.equal(oldOwner.status, 200);
    assert.ok(oldOwner.body.activity.some((entry: any) => entry.type === 'TRANSFERRED'));
    assert.ok(oldOwner.body.activity.some((entry: any) => entry.type === 'COMMENT_ADDED'));
    assert.equal((await executiveACall(`/executive/leads/${lead.body.id}/status`, 'PATCH', { status: 'CONNECTED' })).status, 404);
    assert.equal((await executiveACall(`/executive/leads/${lead.body.id}/comments`, 'POST', { comment: 'Old owner should not update' })).status, 404);

    const currentOwner = await executiveBCall(`/executive/leads/${lead.body.id}`);
    assert.equal(currentOwner.status, 200);
  });

  it('rejects blank or oversized comments', async () => {
    assert.equal((await executiveBCall(`/executive/leads/${lead.body.id}/comments`, 'POST', { comment: ' ' })).status, 400);
    assert.equal((await executiveBCall(`/executive/leads/${lead.body.id}/comments`, 'POST', { comment: 'x'.repeat(2001) })).status, 400);
  });
});
