import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { io, type Socket } from 'socket.io-client';
import { pool } from '../src/database/pool';
import { msUntilNextTimeout, reassignTimedOutLead, runLeadTimeoutSweep } from '../src/modules/leads/lead.service';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let a: any, b: any;
let callA: ReturnType<typeof t.asToken>, callB: ReturnType<typeof t.asToken>;
let adminSocket: Socket;
const adminEvents: { name: string; payload: any }[] = [];
let n = 0;

const lead = async (propertyName: string) =>
  (await t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `97${String(++n).padStart(8, '0')}`, propertyName, source: '99ACRES' })).body;
const backdate = (id: string, minutes: number) => pool.query('UPDATE leads SET assigned_at = now() - make_interval(mins => $2) WHERE id = $1', [id, minutes]);
const row = async (id: string) => (await pool.query('SELECT status, assigned_executive_id AS exec FROM leads WHERE id = $1', [id])).rows[0];
const activity = async (id: string) => (await t.call(`/admin/leads/${id}`)).body.activity as { type: string; message: string }[];
const types = async (id: string) => (await activity(id)).map((x) => x.type);
const settle = () => new Promise((r) => setTimeout(r, 300));

before(async () => {
  t = await startTestApp();
  a = await t.exec('sla.a');
  b = await t.exec('sla.b');
  callA = t.asToken(await t.login('executive', 'sla.a@test.com', 'TempPass123'));
  callB = t.asToken(await t.login('executive', 'sla.b@test.com', 'TempPass123'));
  await t.call('/admin/settings/lead-timeout', 'PUT', { minutes: 45 });
  const token = await t.login('admin', 'admin@test.com', 'Admin-pass-123');
  adminSocket = io(t.base, { auth: { token }, transports: ['websocket'] });
  adminSocket.onAny((name, payload) => adminEvents.push({ name, payload }));
  await new Promise((r) => adminSocket.on('connect', () => r(null)));
});
after(async () => {
  adminSocket.close();
  await t.close();
});

describe('SLA expiry: backend reassigns, records the timeline, then announces', () => {
  it('opening the lead does not stop the SLA; the lead carries the backend deadline', async () => {
    const p = await t.property('Sla Tower', [a.id, b.id]);
    const l = await lead(p.name); // -> a
    const seen = (await callA(`/executive/leads/${l.id}`)).body;
    assert.equal(seen.status, 'INCOMING');
    assert.equal(seen.sla.minutes, 45);
    assert.equal(new Date(seen.sla.deadline).getTime() - new Date(seen.assignedAt).getTime(), 45 * 60_000);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0, 'not due yet');
    assert.equal((await row(l.id)).exec, a.id);
  });

  it('after the deadline: overdue + auto-reassigned in the database, timeline persisted, event and notification delivered, idempotent', async () => {
    const p = await t.property('Sla Plaza', [a.id, b.id]);
    const l = await lead(p.name); // -> a
    assert.deepEqual(await types(l.id), ['LEAD_RECEIVED', 'ASSIGNED', 'SLA_STARTED']);
    await callA(`/executive/leads/${l.id}`); // opening is not a status change
    await backdate(l.id, 46);
    adminEvents.length = 0;

    assert.equal((await runLeadTimeoutSweep()).reassigned, 1);
    assert.equal((await row(l.id)).exec, b.id, 'the database has the new executive');
    await settle();

    const timeline = await activity(l.id);
    assert.deepEqual(timeline.map((x) => x.type), ['LEAD_RECEIVED', 'ASSIGNED', 'SLA_STARTED', 'SLA_BREACHED', 'AUTO_REASSIGNED', 'SLA_STARTED']);
    assert.equal(timeline[3].message, 'SLA breached — marked Overdue');
    assert.equal(timeline[4].message, 'Auto-reassigned to Sla.b after SLA breach');
    assert.equal(timeline[5].message, '45 min SLA started');

    // Real time: the timeline rows arrive as events after the commit, and the lead is already reassigned.
    const live = adminEvents.filter((e) => e.name === 'lead:activity-created' && e.payload.leadId === l.id).map((e) => e.payload.activity.type);
    assert.deepEqual(live, ['SLA_BREACHED', 'AUTO_REASSIGNED', 'SLA_STARTED']);
    assert.ok(adminEvents.some((e) => e.name === 'lead:reassigned' && e.payload.leadId === l.id && e.payload.reason === 'SLA_TIMEOUT'));
    const { rows } = await pool.query("SELECT type FROM notifications WHERE entity_id = $1 ORDER BY created_at", [l.id]);
    assert.ok(rows.some((r) => r.type === 'SLA_EXPIRED'));

    // The new owner gets a fresh SLA, and running the sweep again changes nothing.
    assert.equal((await callB(`/executive/leads/${l.id}`)).body.sla.minutes, 45);
    await runLeadTimeoutSweep();
    await runLeadTimeoutSweep();
    assert.equal((await activity(l.id)).filter((x) => x.type === 'AUTO_REASSIGNED').length, 1);
    assert.equal((await row(l.id)).exec, b.id);
  });

  it('a status change before the deadline stops the SLA: no reassignment, and the change is on the timeline', async () => {
    const p = await t.property('Sla Court', [a.id, b.id]);
    const l = await lead(p.name); // -> a
    assert.equal((await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' })).status, 200);
    await backdate(l.id, 120);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).exec, a.id);
    const timeline = await activity(l.id);
    assert.deepEqual(timeline.map((x) => x.type), ['LEAD_RECEIVED', 'ASSIGNED', 'SLA_STARTED', 'STATUS_CHANGED']);
    assert.equal(timeline[3].message, 'Status changed to Connected by Sla.a');
    assert.equal((await callA(`/executive/leads/${l.id}`)).body.sla, null, 'no running SLA once the status changed');
  });

  it('race: a status change and the sweep at the same moment give exactly one outcome', async () => {
    const p = await t.property('Sla Race', [a.id, b.id]);
    for (let i = 0; i < 6; i++) {
      const l = await lead(p.name);
      const owner = (await row(l.id)).exec === a.id ? callA : callB;
      const other = owner === callA ? b.id : a.id;
      await backdate(l.id, 50);
      const [status, sweep] = await Promise.all([owner(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' }), reassignTimedOutLead(l.id, 45)]);
      const after = await row(l.id);
      const kinds = await types(l.id);
      if (sweep === 'reassigned') {
        // The sweep won: the executive's late update is refused and the lead is not left with a stale status.
        assert.equal(status.status, 404, `round ${i}`);
        assert.equal(after.exec, other);
        assert.equal(after.status, 'INCOMING');
        assert.equal(kinds.filter((k) => k === 'AUTO_REASSIGNED').length, 1);
        assert.ok(!kinds.includes('STATUS_CHANGED'));
      } else {
        // The status change won: the lead stays with its executive and is never reassigned.
        assert.equal(status.status, 200, `round ${i}`);
        assert.equal(after.status, 'RINGING');
        assert.notEqual(after.exec, other);
        assert.ok(!kinds.includes('AUTO_REASSIGNED'));
        assert.equal(kinds.filter((k) => k === 'STATUS_CHANGED').length, 1);
      }
    }
  });

  it('the job can sleep until the next deadline instead of a whole interval', async () => {
    const p = await t.property('Sla Sleep', [a.id]);
    const l = await lead(p.name);
    await pool.query("UPDATE leads SET status = 'CLOSED' WHERE id <> $1", [l.id]);
    await backdate(l.id, 44); // one minute left of 45
    const ms = (await msUntilNextTimeout())!;
    assert.ok(ms > 40_000 && ms <= 60_000, String(ms));
  });
});
