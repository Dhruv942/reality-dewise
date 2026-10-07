import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { io as connectClient, type Socket } from 'socket.io-client';
import { pool } from '../src/database/pool';
import { reassignTimedOutLead, runLeadTimeoutSweep, runSlaWarningPass } from '../src/modules/leads/lead.service';
import { notify } from '../src/modules/notifications/notification.service';
import { signAccessToken } from '../src/utils/jwt';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let adminToken: string, mgr1: any, mgr2: any, a: any, b: any, c: any;
let tokA: string, tokB: string, tokC: string, tokM1: string, tokM2: string;
let callA: ReturnType<typeof t.asToken>, callB: ReturnType<typeof t.asToken>, callM1: ReturnType<typeof t.asToken>;
let n = 0;
const sockets: Socket[] = [];

interface Client { sock: Socket; events: { name: string; payload: any }[]; of: (name: string) => any[] }

/** Connects with the given token and records every event it receives. */
function connect(token: string | undefined): Promise<Client> {
  return new Promise((resolve, reject) => {
    const sock = connectClient(t.base, { auth: token === undefined ? {} : { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(sock);
    const events: Client['events'] = [];
    sock.onAny((name, payload) => events.push({ name, payload }));
    sock.on('connect', () => resolve({ sock, events, of: (name) => events.filter((e) => e.name === name).map((e) => e.payload) }));
    sock.on('connect_error', (err) => reject(err));
  });
}
const settle = () => new Promise((r) => setTimeout(r, 200));
const lead = async (propertyName: string) =>
  (await t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `97${String(++n).padStart(8, '0')}`, propertyName, source: '99ACRES' })).body;
const backdate = (leadId: string, minutes: number) =>
  pool.query('UPDATE leads SET assigned_at = now() - make_interval(mins => $2) WHERE id = $1', [leadId, minutes]);
const notifications = async (userId: string) =>
  (await pool.query('SELECT type, entity_id, is_read FROM notifications WHERE user_id = $1 ORDER BY created_at, id', [userId])).rows;
const mentions = (c: Client, leadId: string) => c.events.filter((e) => JSON.stringify(e.payload).includes(leadId));

before(async () => {
  t = await startTestApp();
  mgr1 = await t.manager('rt.mgr1');
  mgr2 = await t.manager('rt.mgr2');
  const team1 = await t.team('RT Team 1');
  const team2 = await t.team('RT Team 2');
  await t.call(`/admin/teams/${team1.id}`, 'PATCH', { managerId: mgr1.id });
  await t.call(`/admin/teams/${team2.id}`, 'PATCH', { managerId: mgr2.id });
  a = await t.exec('rt.a', team1.id);
  b = await t.exec('rt.b', team2.id);
  c = await t.exec('rt.c');
  adminToken = await t.login('admin', 'admin@test.com', 'Admin-pass-123');
  [tokA, tokB, tokC] = await Promise.all(['rt.a', 'rt.b', 'rt.c'].map((u) => t.login('executive', `${u}@test.com`, 'TempPass123')));
  [tokM1, tokM2] = await Promise.all(['rt.mgr1', 'rt.mgr2'].map((u) => t.login('manager', `${u}@test.com`, 'TempPass123')));
  callA = t.asToken(tokA);
  callB = t.asToken(tokB);
  callM1 = t.asToken(tokM1);
});
after(async () => {
  for (const s of sockets) s.close();
  await t.close();
});

/** The people who could hear about a lead, all connected. */
async function audience() {
  const [admin, A, B, C, M1, M2] = await Promise.all([adminToken, tokA, tokB, tokC, tokM1, tokM2].map(connect));
  return { admin, A, B, C, M1, M2 };
}

describe('socket authentication (same tokens as the REST API)', () => {
  it('accepts a valid token for every role, in the handshake auth or the Authorization header', async () => {
    for (const tok of [adminToken, tokA, tokM1]) assert.ok((await connect(tok)).sock.connected);
    const viaHeader = await new Promise<Socket>((resolve, reject) => {
      const s = connectClient(t.base, { extraHeaders: { authorization: `Bearer ${tokA}` }, transports: ['polling'], reconnection: false, forceNew: true });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
    assert.ok(viaHeader.connected);
  });
  it('rejects a missing, malformed, wrongly signed, expired or unknown-user token', async () => {
    await assert.rejects(connect(undefined), /token missing/i);
    await assert.rejects(connect('not-a-jwt'), /Invalid token/);
    const expired = (await import('jsonwebtoken')).default.sign({ role: 'SALES' }, process.env.JWT_SECRET!, { subject: a.id, expiresIn: -10 });
    await assert.rejects(connect(expired), /expired/i);
    await assert.rejects(connect(signAccessToken({ sub: ZERO, role: 'SALES' })), /Invalid token/);
    const wrongRole = signAccessToken({ sub: a.id, role: 'ADMIN' });
    await assert.rejects(connect(wrongRole), /Invalid token/, 'role must match the database');
  });
  it('rejects a deactivated user, and a session ended by a password change', async () => {
    const x = await t.exec('rt.off');
    const tok = await t.login('executive', 'rt.off@test.com', 'TempPass123');
    assert.ok((await connect(tok)).sock.connected);
    await t.setActive(x.id, false);
    await assert.rejects(connect(tok), /Invalid token/);
  });
  it('closes live sockets when the account is deactivated, deleted or its password is changed', async () => {
    for (const how of ['deactivate', 'delete', 'password'] as const) {
      const x = await t.exec(`rt.${how}`);
      const tok = await t.login('executive', `rt.${how}@test.com`, 'TempPass123');
      const client = await connect(tok);
      const closed = new Promise((r) => client.sock.once('disconnect', r));
      if (how === 'deactivate') await t.setActive(x.id, false);
      if (how === 'delete') await t.call(`/admin/executives/${x.id}`, 'DELETE');
      if (how === 'password') await t.call(`/admin/executives/${x.id}/password`, 'PATCH', { password: 'NewPass12345' });
      await Promise.race([closed, new Promise((_, rej) => setTimeout(() => rej(new Error(`${how}: socket still open`)), 2000))]);
      assert.equal(client.sock.connected, false);
    }
  });
  it('a client cannot put itself in another room', async () => {
    const [A, M1] = await Promise.all([connect(tokA), connect(tokM1)]);
    for (const room of ['admin', 'managers', `executive:${b.id}`, `user:${b.id}`]) {
      A.sock.emit('join', room);
      A.sock.emit('join-room', room);
      A.sock.emit('subscribe', room);
    }
    const p = await t.property('Room Tower', [b.id]);
    const l = await lead(p.name);
    await settle();
    assert.equal(mentions(A, l.id).length, 0, "A never hears about B's lead");
    assert.equal(mentions(M1, l.id).length, 0, 'a manager outside the lead scope does not either');
  });
});

describe('lead created / assigned (round-robin result)', () => {
  it('tells exactly the assigned executive, admin and the executive\'s manager; stores the notification first', async () => {
    const p = await t.property('Alpha Heights', [a.id]);
    const x = await audience();
    const l = await lead(p.name);
    assert.equal(l.assignedExecutive.id, a.id);
    await settle();

    for (const who of [x.admin, x.A, x.M1]) {
      assert.deepEqual(who.of('lead:created').map((e) => e.leadId), [l.id]);
      assert.equal(who.of('lead:assigned').length, 1);
    }
    assert.equal(x.A.of('lead:assigned')[0].lead.customer.mobile, l.customer.mobile);
    assert.equal(x.A.of('lead:assigned')[0].executiveId, a.id);
    assert.equal(x.A.of('lead:assigned')[0].lead.isImportant, undefined, 'the per-user flag is never broadcast');
    for (const who of [x.B, x.C, x.M2]) assert.equal(mentions(who, l.id).length, 0, 'everyone else hears nothing');

    // The executive gets one notification; it already exists in the DB (and over REST) when the event arrives.
    const note = x.A.of('notification:new');
    assert.equal(note.length, 1);
    assert.deepEqual([note[0].type, note[0].entityType, note[0].entityId, note[0].isRead], ['LEAD_ASSIGNED', 'LEAD', l.id, false]);
    const rest = (await callA('/notifications')).body;
    assert.deepEqual(rest.notifications.map((m: any) => m.id), [note[0].id]);
    assert.equal(x.admin.of('notification:new').length, 0, 'admin is not notified of every routine assignment');
    assert.ok(!(await callB('/notifications')).body.notifications.some((m: any) => m.entityId === l.id));
  });

  it('does nothing when creation fails or the same enquiry is submitted again', async () => {
    const p = await t.property('Beta Court', [a.id]);
    const x = await audience();
    assert.equal((await t.call('/admin/leads', 'POST', { name: 'Bad', mobile: 'x', propertyName: p.name, source: '99ACRES' })).status, 400);
    await settle();
    assert.equal(x.admin.events.length, 0);

    const body = { name: 'Dup', mobile: '9811111111', propertyName: p.name, source: '99ACRES', externalLeadId: 'EXT-RT-1' };
    assert.equal((await t.call('/admin/leads', 'POST', body)).status, 201);
    assert.equal((await t.call('/admin/leads', 'POST', body)).status, 200, 'retry returns the existing lead');
    await settle();
    assert.equal(x.admin.of('lead:created').length, 1);
    assert.equal(x.A.of('lead:assigned').length, 1);
    assert.equal(x.A.of('notification:new').length, 1);
  });
});

describe('pending assignment', () => {
  it('a lead nobody can take announces itself to admin and managers only, then lead:assigned when executives are set', async () => {
    const x = await audience();
    const l = await lead('Gamma Greens'); // new property stub: no executives
    assert.equal(l.status, 'PENDING_ASSIGNMENT');
    await settle();
    for (const who of [x.admin, x.M1, x.M2]) {
      assert.equal(who.of('lead:created').length, 1);
      assert.deepEqual(who.of('notification:new').map((m) => m.type), ['LEAD_CREATED']);
    }
    for (const who of [x.A, x.B, x.C]) assert.equal(who.events.length, 0, 'executives are not told about unassigned leads');
    for (const who of [x.admin, x.M1, x.M2]) assert.equal(who.of('lead:assigned').length, 0);

    const propertyId = l.property.id;
    assert.equal((await t.call(`/admin/properties/${propertyId}/executives`, 'PUT', { executiveIds: [b.id] })).status, 200);
    await settle();
    assert.deepEqual(x.B.of('lead:assigned').map((e) => e.leadId), [l.id]);
    assert.deepEqual(x.B.of('notification:new').map((m) => m.type), ['LEAD_ASSIGNED']);
    for (const who of [x.admin, x.M2]) assert.equal(who.of('lead:assigned').length, 1, 'admin and the executive\'s manager');
    assert.equal(mentions(x.A, l.id).length, 0);
    // The other team's manager saw it as pending: they are told it is gone, without customer data.
    const slim = x.M1.of('lead:assigned');
    assert.equal(slim.length, 1);
    assert.equal(slim[0].lead, undefined);
    assert.ok(!JSON.stringify(slim[0]).includes(l.customer.mobile));
    assert.equal(x.M2.of('lead:assigned').length, 1, 'the executive\'s own manager gets it once, with the lead');
    assert.ok(x.M2.of('lead:assigned')[0].lead);
  });
});

describe('status updates', () => {
  it('emits lead:status-updated to the right people; notifies the executive only when someone else changed it', async () => {
    const p = await t.property('Delta Dale', [a.id]);
    const l = await lead(p.name);
    const x = await audience();

    assert.equal((await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' })).status, 200);
    await settle();
    for (const who of [x.admin, x.A, x.M1]) {
      assert.deepEqual(who.of('lead:status-updated').map((e) => [e.leadId, e.status, e.previousStatus]), [[l.id, 'RINGING', 'INCOMING']]);
    }
    assert.equal(x.A.of('notification:new').length, 0, 'the executive made this change themselves');
    for (const who of [x.B, x.C, x.M2]) assert.equal(mentions(who, l.id).length, 0);

    assert.equal((await t.call(`/admin/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' })).status, 200);
    await settle();
    assert.deepEqual(x.A.of('notification:new').map((m) => m.type), ['LEAD_STATUS_UPDATED']);

    // Same status again, and a rejected change, emit nothing.
    const before = x.admin.events.length;
    await t.call(`/admin/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' });
    await t.call(`/admin/leads/${l.id}/status`, 'PATCH', { status: 'NOPE' });
    await settle();
    assert.equal(x.admin.events.length, before);
  });
});

describe('manual reassignment', () => {
  it('lead:reassigned reaches new executive, admin and both managers; the previous executive gets no customer data', async () => {
    const p = await t.property('Echo Estate', [a.id]);
    const l = await lead(p.name);
    const x = await audience();
    assert.equal((await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: b.id })).status, 200);
    await settle();

    assert.equal(x.B.of('lead:reassigned')[0].lead.customer.mobile, l.customer.mobile);
    for (const who of [x.admin, x.M1, x.M2]) assert.equal(who.of('lead:reassigned').length, 1);
    const toA = x.A.of('lead:reassigned');
    assert.equal(toA.length, 1);
    assert.equal(toA[0].lead, undefined);
    assert.ok(!JSON.stringify(toA[0]).includes(l.customer.mobile));
    assert.deepEqual(x.B.of('notification:new').map((m) => m.type), ['LEAD_REASSIGNED']);
    assert.deepEqual(x.A.of('notification:new').map((m) => m.type), ['LEAD_REASSIGNED']);
    assert.equal(x.C.events.length, 0);

    // Assigning to the executive who already has it is a no-op.
    const count = x.admin.events.length;
    await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: b.id });
    await settle();
    assert.equal(x.admin.events.length, count);
  });
});

describe('SLA warning, expiry and automatic reassignment', () => {
  it('warns once per assignment, with expiry and remaining time', async () => {
    const p = await t.property('Foxtrot Fields', [a.id, b.id]);
    const l = await lead(p.name); // -> a
    const x = await audience();
    await backdate(l.id, 85); // SLA is 90 minutes, warning window is the last 10

    assert.equal(await runSlaWarningPass(), 1);
    await settle();
    const w = x.A.of('lead:sla-warning');
    assert.equal(w.length, 1);
    assert.equal(w[0].leadId, l.id);
    assert.equal(w[0].executiveId, a.id);
    assert.ok(Math.abs(w[0].remainingSeconds - 300) <= 5, `about 5 minutes left, got ${w[0].remainingSeconds}`);
    assert.ok(new Date(w[0].expiresAt).getTime() > Date.now());
    for (const who of [x.admin, x.M1]) assert.equal(who.of('lead:sla-warning').length, 1);
    for (const who of [x.B, x.C, x.M2]) assert.equal(mentions(who, l.id).length, 0);
    assert.deepEqual(x.A.of('notification:new').map((m) => m.type), ['SLA_WARNING']);

    await runSlaWarningPass();
    await runSlaWarningPass();
    await settle();
    assert.equal(x.A.of('lead:sla-warning').length, 1, 'a job re-run does not warn again');
    assert.equal((await notifications(a.id)).filter((m) => m.type === 'SLA_WARNING' && m.entity_id === l.id).length, 1);
  });

  it('no warning before the window, none once handled, none when the SLA is too short for one', async () => {
    const p = await t.property('Golf Gardens', [a.id]);
    const early = await lead(p.name);
    await backdate(early.id, 60);
    const handled = await lead(p.name);
    await backdate(handled.id, 85);
    await callA(`/executive/leads/${handled.id}/status`, 'PATCH', { status: 'CONNECTED' });
    assert.equal(await runSlaWarningPass(), 0);
    await t.call('/admin/settings/lead-timeout', 'PUT', { minutes: 1 });
    await backdate(early.id, 0);
    assert.equal(await runSlaWarningPass(), 0, 'a 1-minute SLA has no warning window');
    await t.call('/admin/settings/lead-timeout', 'PUT', { minutes: 90 });
    await pool.query("UPDATE leads SET status = 'CLOSED' WHERE id = ANY($1)", [[early.id, handled.id]]);
  });

  it('expiry: sla-expired, then lead:reassigned; notifications for old, new, admin and managers; no duplicates', async () => {
    const p = await t.property('Hotel Heights', [a.id, b.id]);
    const l = await lead(p.name); // -> a
    assert.equal(l.assignedExecutive.id, a.id);
    const x = await audience();
    await backdate(l.id, 91);

    assert.equal((await runLeadTimeoutSweep()).reassigned, 1);
    await settle();

    // Old executive (and their manager, admin): expired first, then the reassignment, no customer data in it.
    const orderA = x.A.events.filter((e) => e.name.startsWith('lead:') && e.name !== 'lead:activity-created').map((e) => e.name);
    assert.deepEqual(orderA, ['lead:sla-expired', 'lead:reassigned']);
    assert.equal(x.A.of('lead:reassigned')[0].lead, undefined);
    assert.deepEqual(x.A.of('notification:new').map((m) => m.type), ['SLA_EXPIRED']);
    assert.deepEqual(x.admin.events.filter((e) => e.name.startsWith('lead:') && e.name !== 'lead:activity-created').map((e) => e.name), ['lead:sla-expired', 'lead:reassigned']);
    assert.deepEqual(x.M1.events.filter((e) => e.name.startsWith('lead:') && e.name !== 'lead:activity-created').map((e) => e.name), ['lead:sla-expired', 'lead:reassigned']);
    // New executive and their manager: the reassignment with the lead.
    assert.deepEqual(x.B.events.filter((e) => e.name.startsWith('lead:') && e.name !== 'lead:activity-created').map((e) => e.name), ['lead:reassigned']);
    assert.equal(x.B.of('lead:reassigned')[0].reason, 'SLA_TIMEOUT');
    assert.equal(x.B.of('lead:reassigned')[0].lead.assignedExecutive.id, b.id);
    assert.deepEqual(x.B.of('notification:new').map((m) => m.type), ['LEAD_REASSIGNED']);
    assert.deepEqual(x.M2.events.filter((e) => e.name.startsWith('lead:') && e.name !== 'lead:activity-created').map((e) => e.name), ['lead:reassigned']);
    // Admin and managers in scope are notified too.
    assert.deepEqual(x.admin.of('notification:new').map((m) => m.type), ['LEAD_REASSIGNED']);
    assert.deepEqual(x.M1.of('notification:new').map((m) => m.type), ['LEAD_REASSIGNED']);
    assert.equal(x.C.events.length, 0);

    // Nothing is replayed by the next sweeps.
    await runLeadTimeoutSweep();
    await runLeadTimeoutSweep();
    await settle();
    assert.equal(x.A.of('lead:sla-expired').length, 1);
    assert.equal(x.B.of('lead:reassigned').length, 1);
    assert.equal((await notifications(a.id)).filter((m) => m.entity_id === l.id && m.type === 'SLA_EXPIRED').length, 1);
  });

  it('concurrent sweeps reassign once and announce once; a skipped lead announces nothing', async () => {
    const p = await t.property('India Isle', [a.id, b.id]);
    const l = await lead(p.name);
    const x = await audience();
    await backdate(l.id, 95);
    const results = await Promise.all(Array.from({ length: 6 }, () => reassignTimedOutLead(l.id, 90)));
    assert.equal(results.filter((r) => r === 'reassigned').length, 1);
    await settle();
    assert.equal(x.A.of('lead:sla-expired').length, 1);
    assert.equal(x.B.of('lead:reassigned').length, 1);

    const solo = await t.property('Juliet Jetty', [c.id]);
    const s = await lead(solo.name);
    await backdate(s.id, 95);
    const before = x.admin.events.length;
    assert.equal(await reassignTimedOutLead(s.id, 90), 'skipped', 'nobody else to take it');
    await settle();
    assert.equal(x.admin.events.length, before);
    assert.equal((await notifications(c.id)).filter((m) => m.type === 'SLA_EXPIRED').length, 0);
  });
});

describe('notification APIs', () => {
  it('lists only the caller\'s notifications, newest first, with the unread count', async () => {
    const mine = (await callA('/notifications')).body;
    assert.ok(mine.notifications.length >= 3);
    assert.equal(mine.unreadCount, mine.notifications.filter((m: any) => !m.isRead).length);
    const times = mine.notifications.map((m: any) => +new Date(m.createdAt));
    assert.deepEqual(times, [...times].sort((x, y) => y - x));
    assert.deepEqual(Object.keys(mine.notifications[0]).sort(), ['createdAt', 'entityId', 'entityType', 'id', 'isRead', 'message', 'readAt', 'title', 'type']);
    const ids = new Set(mine.notifications.map((m: any) => m.id));
    for (const m of (await callB('/notifications')).body.notifications) assert.ok(!ids.has(m.id), "never someone else's");
    assert.equal((await callA('/notifications?limit=2&offset=1')).body.notifications.length, 2);
    assert.equal((await callA('/notifications?limit=0')).status, 400);
  });

  it('requires authentication', async () => {
    for (const [path, method] of [['/notifications', 'GET'], ['/notifications/read-all', 'PATCH'], [`/notifications/${ZERO}/read`, 'PATCH']] as const) {
      assert.equal((await t.asToken('')(path, method)).status, 401);
    }
  });

  it('mark as read: idempotent, owner only', async () => {
    const first = (await callA('/notifications?unread=true')).body.notifications[0];
    const r = await callA(`/notifications/${first.id}/read`, 'PATCH');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.isRead, r.body.readAt !== null], [true, true]);
    const again = await callA(`/notifications/${first.id}/read`, 'PATCH');
    assert.equal(again.body.readAt, r.body.readAt, 'the first read time is kept');
    assert.equal((await callB(`/notifications/${first.id}/read`, 'PATCH')).status, 404, "B cannot touch A's notification");
    assert.equal((await callA(`/notifications/${ZERO}/read`, 'PATCH')).status, 404);
    assert.equal((await callA('/notifications/not-a-uuid/read', 'PATCH')).status, 400);
    assert.ok(!(await callA('/notifications?unread=true')).body.notifications.some((m: any) => m.id === first.id));
  });

  it('read-all marks only the caller\'s notifications', async () => {
    const bUnread = (await callB('/notifications')).body.unreadCount;
    assert.ok(bUnread > 0);
    const r = await callA('/notifications/read-all', 'PATCH');
    assert.equal(r.status, 200);
    assert.ok(r.body.updated >= 1);
    const after = (await callA('/notifications')).body;
    assert.equal(after.unreadCount, 0);
    assert.ok(after.notifications.every((m: any) => m.isRead));
    assert.equal((await callB('/notifications')).body.unreadCount, bUnread, "B's are untouched");
    assert.equal((await callA('/notifications/read-all', 'PATCH')).body.updated, 0);
  });
});

describe('idempotency and reconnection', () => {
  it('the same business event notifies a user once, whatever the retries', async () => {
    const A = await connect(tokA);
    const entityId = '11111111-1111-4111-8111-111111111111';
    const n1 = { userId: a.id, type: 'SLA_WARNING' as const, title: 'T', message: 'M', entityType: 'LEAD', entityId, dedupeKey: 'test-dedupe' };
    const results = await Promise.all([notify(n1), notify(n1), notify(n1)]);
    assert.equal(results.filter(Boolean).length, 1);
    await settle();
    assert.equal(A.of('notification:new').length, 1);
    assert.equal((await pool.query('SELECT 1 FROM notifications WHERE user_id = $1 AND dedupe_key = $2', [a.id, 'test-dedupe'])).rowCount, 1);
  });

  it('reconnecting creates nothing and replays nothing; missed notifications are available over REST', async () => {
    const before = (await notifications(b.id)).length;
    const first = await connect(tokB);
    first.sock.close();
    const p = await t.property('Kilo Keep', [b.id]);
    const l = await lead(p.name); // happens while B is offline
    await settle();
    assert.equal((await notifications(b.id)).length, before + 1);

    const second = await connect(tokB);
    await settle();
    assert.equal(second.events.length, 0, 'no replay on connect');
    assert.equal((await notifications(b.id)).length, before + 1, 'connecting never creates a notification');
    const missed = (await callB('/notifications?unread=true')).body.notifications;
    assert.ok(missed.some((m: any) => m.entityId === l.id && m.type === 'LEAD_ASSIGNED'));

    // The new connection is in B's rooms again: live events work.
    const l2 = await lead(p.name);
    await settle();
    assert.deepEqual(second.of('lead:assigned').map((e) => e.leadId), [l2.id]);
    assert.equal(second.of('lead:assigned').length, 1, 'one handler, one delivery');
  });

  it('a push failure never breaks the business operation', async () => {
    const real = pool.query.bind(pool);
    const p = await t.property('Lima Lane', [a.id]);
    // Make only the notification insert fail.
    (pool as any).query = (sql: any, ...rest: any[]) => (typeof sql === 'string' && sql.includes('INSERT INTO notifications') ? Promise.reject(new Error('boom')) : (real as any)(sql, ...rest));
    try {
      const r = await t.call('/admin/leads', 'POST', { name: 'Resilient', mobile: '9822222222', propertyName: p.name, source: '99ACRES' });
      assert.equal(r.status, 201);
      assert.equal(r.body.assignedExecutive.id, a.id);
    } finally {
      (pool as any).query = real;
    }
  });
});
