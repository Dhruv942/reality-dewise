import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let manager: any;
let otherManager: any;
let executive: any;
let executiveCall: ReturnType<typeof t.asToken>;
let property: any;

before(async () => {
  t = await startTestApp();
  manager = await t.manager('history-manager');
  otherManager = await t.manager('other-history-manager');
  executive = await t.exec('history-exec', manager.id);
  executiveCall = t.asToken(await t.login('executive', 'history-exec@test.com', 'TempPass123'));
  property = await t.property('History Heights', [executive.id]);
});

after(() => t.close());

const notificationsFor = async (userId: string) =>
  (await pool.query('SELECT type, title, message, entity_id, is_read FROM notifications WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;

describe('new lead notifications with customer history', () => {
  it('notifies admin and the relevant manager with previous enquiry history', async () => {
    const mobile = '9000002001';
    const previous = await t.call('/admin/leads', 'POST', {
      name: 'Returning Customer',
      mobile,
      email: 'returning@example.com',
      propertyName: property.name,
      source: '99ACRES',
      message: 'Previous remark',
    });
    await executiveCall(`/executive/leads/${previous.body.id}/status`, 'PATCH', { status: 'LOST', reason: 'OTHER', otherReason: 'Client postponed' });
    const closed = await t.call('/admin/leads', 'POST', {
      name: 'Returning Customer',
      mobile,
      propertyName: property.name,
      source: '99ACRES',
      message: 'Earlier closed remark',
    });
    await executiveCall(`/executive/leads/${closed.body.id}/status`, 'PATCH', { status: 'CLOSED' });
    await executiveCall(`/executive/leads/${closed.body.id}/follow-up`, 'PUT', {
      followUpAt: new Date(Date.now() + 86_400_000).toISOString(),
      followUpNote: 'Closed customer follow-up',
    });

    const next = await t.call('/admin/leads', 'POST', {
      name: 'Returning Customer',
      mobile,
      email: 'returning@example.com',
      propertyName: 'New Requirement Tower',
      source: 'MAGICBRICKS',
      requirement: '3 BHK Buy',
    });
    assert.equal(next.status, 201);

    const adminId = (await pool.query("SELECT id FROM users WHERE email = 'admin@test.com'")).rows[0].id;
    const adminNotification = (await notificationsFor(adminId)).find((n: any) => n.entity_id === next.body.id);
    const managerNotification = (await notificationsFor(manager.id)).find((n: any) => n.entity_id === next.body.id);
    for (const notification of [adminNotification, managerNotification]) {
      assert.ok(notification);
      assert.equal(notification.type, 'LEAD_CREATED');
      assert.match(notification.title, /New Lead Received/);
      assert.match(notification.message, /Returning Customer/);
      assert.match(notification.message, /9000002001/);
      assert.match(notification.message, /Previous Enquiries: 2/);
      assert.match(notification.message, /Client postponed/);
      assert.match(notification.message, /History Heights/);
      assert.match(notification.message, /Previous Lead Statuses:.*CLOSED/);
      assert.match(notification.message, /No recorded deal\/conversion record/);
      assert.match(notification.message, /Closed customer follow-up/);
      assert.match(notification.message, /^\*New Lead Received — Customer History\*/);
      assert.match(notification.message, /\*Customer Details\*/);
      assert.match(notification.message, /\*Previous Customer History\*/);
      assert.match(notification.message, /\*Summary:\*/);
      assert.doesNotMatch(notification.message, /<[^>]+>|```|\"customer_id\"/);
    }
  });

  it('does not duplicate the Admin/Manager notification when an external lead is retried', async () => {
    const body = { name: 'Retry Customer', mobile: '9000002002', propertyName: property.name, source: '99ACRES', externalLeadId: 'HISTORY-RETRY-1' };
    const first = await t.call('/admin/leads', 'POST', body);
    const second = await t.call('/admin/leads', 'POST', body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const adminId = (await pool.query("SELECT id FROM users WHERE email = 'admin@test.com'")).rows[0].id;
    const rows = await notificationsFor(adminId);
    assert.equal(rows.filter((n: any) => n.entity_id === first.body.id && n.type === 'LEAD_CREATED').length, 1);
  });

  it('notifies all managers for an unassigned lead and does not notify an unrelated manager for an assigned lead', async () => {
    const assigned = await t.call('/admin/leads', 'POST', {
      name: 'Scoped Customer',
      mobile: '9000002003',
      propertyName: property.name,
      source: '99ACRES',
    });
    const unrelated = (await notificationsFor(otherManager.id)).find((n: any) => n.entity_id === assigned.body.id);
    assert.equal(unrelated, undefined);

    const pending = await t.call('/admin/leads', 'POST', {
      name: 'New Customer',
      mobile: '9000002004',
      propertyName: 'Unassigned History Tower',
      source: 'MAGICBRICKS',
    });
    const adminId = (await pool.query("SELECT id FROM users WHERE email = 'admin@test.com'")).rows[0].id;
    const adminNote = (await notificationsFor(adminId)).find((n: any) => n.entity_id === pending.body.id);
    const managerNote = (await notificationsFor(otherManager.id)).find((n: any) => n.entity_id === pending.body.id);
    assert.match(adminNote.message, /no previous enquiries or recorded deals\/conversions were found/i);
    assert.match(managerNote.message, /Assigned Executive: Unassigned/);
  });
});
