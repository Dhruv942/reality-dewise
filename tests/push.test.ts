import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient, type Socket } from 'socket.io-client';
import { pool } from '../src/database/pool';
import { runSlaWarningPass } from '../src/modules/leads/lead.service';
import { notify } from '../src/modules/notifications/notification.service';
import { pushIdle, setPushTransport, type PushTarget } from '../src/modules/push/push.service';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let a: any, b: any;
let callA: ReturnType<typeof t.asToken>, callB: ReturnType<typeof t.asToken>, tokA: string;
let n = 0;
const sockets: Socket[] = [];

interface Sent { target: PushTarget; payload: any; options: any }
let sent: Sent[] = [];
let failWith: ((target: PushTarget) => { statusCode?: number } | null) | null = null;

const sub = (name: string) => ({ endpoint: `https://push.example.com/${name}`, expirationTime: null, keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` } });
const devices = async (userId: string) => (await pool.query('SELECT endpoint, failure_count FROM push_subscriptions WHERE user_id = $1 ORDER BY endpoint', [userId])).rows;
const lead = async (propertyName: string) =>
  (await t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `95${String(++n).padStart(8, '0')}`, propertyName, source: '99ACRES' })).body;
const settle = () => new Promise((r) => setTimeout(r, 150));
const connect = (token: string) =>
  new Promise<Socket>((resolve, reject) => {
    const s = connectClient(t.base, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });

before(async () => {
  t = await startTestApp();
  a = await t.exec('push.a');
  b = await t.exec('push.b');
  tokA = await t.login('executive', 'push.a@test.com', 'TempPass123');
  callA = t.asToken(tokA);
  callB = t.asToken(await t.login('executive', 'push.b@test.com', 'TempPass123'));
  setPushTransport(async (target, payload, options) => {
    const err = failWith?.(target);
    if (err) throw Object.assign(new Error('push service error'), err);
    sent.push({ target, payload: JSON.parse(payload), options });
  });
});
beforeEach(async () => {
  sent = [];
  failWith = null;
  await pool.query('DELETE FROM push_subscriptions');
});
after(async () => {
  setPushTransport(null);
  for (const s of sockets) s.close();
  await t.close();
});

describe('push subscription API', () => {
  it('requires login', async () => {
    const anon = t.asToken('');
    assert.equal((await anon('/push/public-key')).status, 401);
    assert.equal((await anon('/push/subscriptions', 'POST', sub('x'))).status, 401);
    assert.equal((await anon('/push/subscriptions', 'DELETE', { endpoint: 'https://x' })).status, 401);
  });
  it('public key is 503 until VAPID keys are configured', async () => {
    assert.equal((await callA('/push/public-key')).status, 503);
  });
  it('registers a device (idempotent) and validates the subscription', async () => {
    assert.equal((await callA('/push/subscriptions', 'POST', sub('a1'))).status, 201);
    assert.equal((await callA('/push/subscriptions', 'POST', sub('a1'))).status, 201);
    assert.equal((await devices(a.id)).length, 1);
    for (const bad of [{}, { endpoint: 'http://insecure.example.com/x', keys: { p256dh: 'p', auth: 'a' } }, { endpoint: 'https://x.example.com/y' }, { endpoint: 'https://x.example.com/y', keys: { p256dh: 'p' } }, { endpoint: 'not a url', keys: { p256dh: 'p', auth: 'a' } }]) {
      assert.equal((await callA('/push/subscriptions', 'POST', bad)).status, 400, JSON.stringify(bad));
    }
  });
  it('a device re-registered by another user moves to that user (shared computer)', async () => {
    await callA('/push/subscriptions', 'POST', sub('shared'));
    await callB('/push/subscriptions', 'POST', sub('shared'));
    assert.equal((await devices(a.id)).length, 0);
    assert.equal((await devices(b.id)).length, 1);
  });
  it('unsubscribe removes only the caller\'s device', async () => {
    await callA('/push/subscriptions', 'POST', sub('a2'));
    assert.deepEqual((await callB('/push/subscriptions', 'DELETE', { endpoint: sub('a2').endpoint })).body.removed, false);
    assert.equal((await devices(a.id)).length, 1);
    assert.deepEqual((await callA('/push/subscriptions', 'DELETE', { endpoint: sub('a2').endpoint })).body.removed, true);
    assert.equal((await devices(a.id)).length, 0);
  });
  it('keeps at most 10 devices per user, newest first', async () => {
    for (let i = 0; i < 12; i++) await callA('/push/subscriptions', 'POST', sub(`cap${String(i).padStart(2, '0')}`));
    const d = await devices(a.id);
    assert.equal(d.length, 10);
    assert.ok(!d.some((x) => x.endpoint.endsWith('cap00')) && d.some((x) => x.endpoint.endsWith('cap11')));
  });
});

describe('push delivery', () => {
  it('assignment pushes to the executive\'s devices when the app is closed; payload has no customer data', async () => {
    await callA('/push/subscriptions', 'POST', sub('phone'));
    await callA('/push/subscriptions', 'POST', sub('laptop'));
    await callB('/push/subscriptions', 'POST', sub('other'));
    const p = await t.property('Push Plaza', [a.id]);
    const l = await lead(p.name);
    await pushIdle();

    assert.deepEqual(sent.map((s) => s.target.endpoint).sort(), [sub('laptop').endpoint, sub('phone').endpoint]);
    const msg = sent[0].payload;
    assert.deepEqual([msg.type, msg.entityType, msg.entityId, msg.requireInteraction], ['LEAD_ASSIGNED', 'LEAD', l.id, false]);
    assert.equal(msg.tag, `LEAD_ASSIGNED:${l.id}`);
    assert.ok(msg.notificationId && msg.title && msg.body);
    assert.ok(!JSON.stringify(msg).includes(l.customer.mobile) && !JSON.stringify(msg).includes('Buyer'), 'no customer details');
    assert.deepEqual([sent[0].options.TTL, sent[0].options.urgency], [3600, 'high']);
    assert.ok(!sent.some((s) => s.target.endpoint === sub('other').endpoint), "never someone else's device");
  });

  it('is skipped while the app is open (live socket), except for SLA alerts', async () => {
    await callA('/push/subscriptions', 'POST', sub('open'));
    const p = await t.property('Open App Tower', [a.id]);
    const s = await connect(tokA);
    const l = await lead(p.name);
    await pushIdle();
    assert.equal(sent.length, 0, 'the app shows it live');

    await pool.query('UPDATE leads SET assigned_at = now() - interval \'85 minutes\' WHERE id = $1', [l.id]);
    assert.equal(await runSlaWarningPass(), 1);
    await pushIdle();
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].payload.type, sent[0].payload.requireInteraction], ['SLA_WARNING', true]);

    s.close();
    await settle();
    const l2 = await lead(p.name);
    await pushIdle();
    assert.equal(sent.length, 2, 'app closed again: assignments push');
    assert.equal(sent[1].payload.entityId, l2.id);
  });

  it('only the listed types push: a status change does not', async () => {
    await callA('/push/subscriptions', 'POST', sub('status'));
    const p = await t.property('Status Square', [a.id]);
    const l = await lead(p.name);
    await pushIdle();
    sent = [];
    await t.call(`/admin/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' }); // creates LEAD_STATUS_UPDATED
    await pushIdle();
    assert.equal((await pool.query("SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'LEAD_STATUS_UPDATED'", [a.id])).rowCount, 1);
    assert.equal(sent.length, 0);
  });

  it('a repeated business event pushes once', async () => {
    await callA('/push/subscriptions', 'POST', sub('dup'));
    const ev = { userId: a.id, type: 'SLA_EXPIRED' as const, title: 'T', message: 'M', entityType: 'LEAD', entityId: '22222222-2222-4222-8222-222222222222', dedupeKey: 'push-dup' };
    await Promise.all([notify(ev), notify(ev), notify(ev)]);
    await pushIdle();
    assert.equal(sent.length, 1);
  });

  it('a gone device (410/404) is removed; repeated failures remove it; other devices still get the push', async () => {
    await callA('/push/subscriptions', 'POST', sub('good'));
    await callA('/push/subscriptions', 'POST', sub('gone'));
    await callA('/push/subscriptions', 'POST', sub('flaky'));
    failWith = (target) => (target.endpoint.endsWith('/gone') ? { statusCode: 410 } : target.endpoint.endsWith('/flaky') ? { statusCode: 500 } : null);
    const p = await t.property('Failure Falls', [a.id]);
    for (let i = 0; i < 5; i++) {
      await lead(p.name);
      await pushIdle();
    }
    assert.equal(sent.filter((s) => s.target.endpoint.endsWith('/good')).length, 5, 'healthy device unaffected');
    const left = (await devices(a.id)).map((d) => d.endpoint.split('/').pop());
    assert.deepEqual(left, ['good'], '410 removed at once, 500 after 5 failures');
  });

  it('a push failure never breaks the business operation', async () => {
    await callA('/push/subscriptions', 'POST', sub('boom'));
    failWith = () => ({ statusCode: 500 });
    const p = await t.property('Boom Bay', [a.id]);
    const r = await t.call('/admin/leads', 'POST', { name: 'Resilient', mobile: '9833333333', propertyName: p.name, source: '99ACRES' });
    assert.equal(r.status, 201);
    await pushIdle();
  });

  it('deactivating an account removes its devices', async () => {
    const x = await t.exec('push.off');
    const call = t.asToken(await t.login('executive', 'push.off@test.com', 'TempPass123'));
    await call('/push/subscriptions', 'POST', sub('off'));
    assert.equal((await devices(x.id)).length, 1);
    await t.setActive(x.id, false);
    assert.equal((await devices(x.id)).length, 0);
  });
});
