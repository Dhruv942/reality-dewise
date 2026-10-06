import { after, afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { reassignTimedOutLead, runLeadTimeoutSweep } from '../src/modules/leads/lead.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let a: any, b: any, c: any;
let callA: ReturnType<typeof t.asToken>, callB: ReturnType<typeof t.asToken>, callC: ReturnType<typeof t.asToken>;
let mgrCall: ReturnType<typeof t.asToken>, salesCall: ReturnType<typeof t.asToken>;
let n = 0;

const lead = async (propertyName: string) =>
  (await t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `96${String(++n).padStart(8, '0')}`, propertyName, source: '99ACRES' })).body;
const backdate = (leadId: string, minutes: number) =>
  pool.query("UPDATE leads SET assigned_at = now() - make_interval(mins => $2) WHERE id = $1", [leadId, minutes]);
const row = async (leadId: string) =>
  (await pool.query('SELECT status, assigned_executive_id AS exec, assigned_at, seen_at FROM leads WHERE id = $1', [leadId])).rows[0];
const history = async (leadId: string) =>
  (await pool.query('SELECT method, executive_id, assigned_by_id FROM property_assignment_history WHERE lead_id = $1 ORDER BY created_at, id', [leadId])).rows;
const timeouts = async (leadId: string) => (await history(leadId)).filter((h) => h.method === 'TIMEOUT');
const setTimeoutMinutes = (minutes: number) => t.call('/admin/settings/lead-timeout', 'PUT', { minutes });

before(async () => {
  t = await startTestApp();
  const mgr = await t.manager('to.mgr');
  void mgr;
  a = await t.exec('to.a');
  b = await t.exec('to.b');
  c = await t.exec('to.c');
  callA = t.asToken(await t.login('executive', 'to.a@test.com', 'TempPass123'));
  callB = t.asToken(await t.login('executive', 'to.b@test.com', 'TempPass123'));
  callC = t.asToken(await t.login('executive', 'to.c@test.com', 'TempPass123'));
  mgrCall = t.asToken(await t.login('manager', 'to.mgr@test.com', 'TempPass123'));
  salesCall = callA;
});
after(() => t.close());
// Tests that evaluate the SLA at fixed moments (Dec 2025 - Feb 2026) leave leads with old assignment times behind.
// Close them so a later sweep, evaluated at another fixed moment, never picks them up again.
afterEach(() => pool.query("UPDATE leads SET status = 'CLOSED' WHERE assigned_at < '2026-03-01'"));

describe('lead SLA setting (admin only, default 90 minutes)', () => {
  it('the default is 90 minutes', async () => {
    await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'");
    const r = await t.call('/admin/settings/lead-timeout');
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.minutes, r.body.defaultMinutes, r.body.isDefault], [90, 90, true]);
    assert.deepEqual([r.body.minMinutes, r.body.maxMinutes], [1, 10080]);
    assert.equal(r.body.updatedAt, null);
  });
  it('admin can change it; it is stored, attributed and read back', async () => {
    const r = await setTimeoutMinutes(30);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.minutes, r.body.isDefault, r.body.updatedBy.name], [30, false, 'Admin']);
    assert.equal((await pool.query("SELECT value FROM app_settings WHERE key = 'lead_timeout_minutes'")).rows[0].value, '30');
    assert.equal((await t.call('/admin/settings/lead-timeout')).body.minutes, 30);
    assert.equal((await setTimeoutMinutes(90)).body.isDefault, true);
    assert.equal((await setTimeoutMinutes(60)).body.isDefault, false, '60 is now just a custom value');
    await setTimeoutMinutes(90);
  });
  it('validation: whole minutes between 1 and 10080; unknown fields rejected', async () => {
    for (const body of [{ minutes: 0 }, { minutes: -5 }, { minutes: 10081 }, { minutes: 1.5 }, { minutes: '60' }, {}, { minutes: 60, extra: 1 }, { rule: 60 }]) {
      assert.equal((await t.call('/admin/settings/lead-timeout', 'PUT', body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await setTimeoutMinutes(1)).status, 200);
    assert.equal((await setTimeoutMinutes(10080)).status, 200);
    await setTimeoutMinutes(90);
  });
  it('the database refuses an invalid stored value', async () => {
    for (const v of ['0', '-1', 'abc', '10081', '1.5', '']) {
      await assert.rejects(pool.query("UPDATE app_settings SET value = $1 WHERE key = 'lead_timeout_minutes'", [v]), /app_settings_lead_timeout_check/, v);
    }
  });
  it('managers and sales users cannot read or change it (403); no token is 401; nothing changes', async () => {
    for (const call of [mgrCall, salesCall]) {
      assert.equal((await call('/admin/settings/lead-timeout')).status, 403);
      assert.equal((await call('/admin/settings/lead-timeout', 'PUT', { minutes: 5 })).status, 403);
    }
    assert.equal((await t.asToken('')('/admin/settings/lead-timeout', 'PUT', { minutes: 5 })).status, 401);
    assert.equal((await t.call('/admin/settings/lead-timeout')).body.minutes, 90);
  });
});

describe('timeout: a lead nobody handled is reassigned', () => {
  it('89 minutes is not enough; 90 minutes reassigns it to the next executive, recorded as TIMEOUT', async () => {
    const p = await t.property('Timeout Towers', [a.id, b.id, c.id]);
    const l = await lead(p.name);
    assert.equal(l.assignedExecutive.id, a.id);
    assert.equal(l.status, 'INCOMING');

    await backdate(l.id, 89);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).exec, a.id);

    await backdate(l.id, 90);
    const r = await runLeadTimeoutSweep();
    assert.equal(r.reassigned, 1);
    assert.equal(r.timeoutMinutes, 90);
    const after = await row(l.id);
    assert.equal(after.exec, b.id);
    assert.equal(after.status, 'INCOMING');
    const h = await history(l.id);
    assert.deepEqual(h.map((x) => x.method), ['ROUND_ROBIN', 'TIMEOUT']);
    assert.equal(h[1].executive_id, b.id);
    assert.equal(h[1].assigned_by_id, null, 'system action');
    const ph = (await t.call(`/admin/properties/${p.id}/assignment-history`)).body.history;
    assert.ok(ph.some((x: any) => x.leadId === l.id && x.method === 'TIMEOUT' && x.assignedBy === null));
  });

  it('the timer restarts from the reassignment and the rotation continues until someone handles it', async () => {
    const p = await t.property('Rotation Timeout', [a.id, b.id, c.id]);
    const l = await lead(p.name); // a
    const seen = [(await row(l.id)).exec];
    for (let i = 0; i < 4; i++) {
      await backdate(l.id, 91);
      assert.equal((await runLeadTimeoutSweep()).reassigned, 1);
      const cur = await row(l.id);
      seen.push(cur.exec);
      assert.ok(Date.now() - new Date(cur.assigned_at).getTime() < 60_000, 'timer restarted at the reassignment');
      assert.equal((await runLeadTimeoutSweep()).reassigned, 0, 'not due again straight away');
    }
    assert.deepEqual(seen, [a.id, b.id, c.id, a.id, b.id]);
    assert.deepEqual((await history(l.id)).map((h) => h.method), ['ROUND_ROBIN', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT', 'TIMEOUT']);
    // the executive who has it now handles it: the rotation stops
    await callB(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' });
    await backdate(l.id, 500);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).exec, b.id);
  });

  it('it never hands the lead back to the executive who has it, even when the rotation points at them', async () => {
    const p = await t.property('Skip Self Square', [a.id, b.id, c.id]);
    const l1 = await lead(p.name); // a
    await lead(p.name); // b
    await lead(p.name); // c -> pointer is at c, so the "next" would be a again
    await backdate(l1.id, 91);
    await runLeadTimeoutSweep();
    assert.equal((await row(l1.id)).exec, b.id);
  });

  it('inactive executives are skipped; nobody else available means the lead stays', async () => {
    const p = await t.property('Skip Inactive Inn', [a.id, b.id, c.id]);
    const l = await lead(p.name); // a
    await t.setActive(b.id, false);
    await backdate(l.id, 91);
    await runLeadTimeoutSweep();
    assert.equal((await row(l.id)).exec, c.id, 'b is inactive');
    await t.setActive(b.id, true);

    const solo = await t.property('Solo Suites', [a.id]);
    const s = await lead(solo.name);
    await backdate(s.id, 500);
    const r = await runLeadTimeoutSweep();
    assert.equal((await row(s.id)).exec, a.id, 'only one executive: nothing to rotate to');
    assert.equal((await timeouts(s.id)).length, 0);
    assert.ok(r.skipped >= 1);
  });

  it('a lead of an inactive property is left alone', async () => {
    const p = await t.property('Closed Court', [a.id, b.id]);
    const l = await lead(p.name);
    await t.call(`/admin/properties/${p.id}/status`, 'PATCH', { isActive: false });
    await backdate(l.id, 500);
    await runLeadTimeoutSweep();
    assert.equal((await row(l.id)).exec, a.id);
  });

  it('pending (unassigned) leads are never touched', async () => {
    const empty = await t.property('Nobody Nest');
    const l = await lead(empty.name);
    assert.equal(l.status, 'PENDING_ASSIGNMENT');
    await pool.query("UPDATE leads SET created_at = now() - interval '5 hours' WHERE id = $1", [l.id]);
    await runLeadTimeoutSweep();
    assert.equal((await row(l.id)).status, 'PENDING_ASSIGNMENT');
    assert.equal((await timeouts(l.id)).length, 0);
  });
});

describe('timeout: handled leads are left alone', () => {
  it('any status other than INCOMING counts as handled', async () => {
    const p = await t.property('Handled Heights', [a.id, b.id]);
    for (const status of ['RINGING', 'CONNECTED', 'CLOSED', 'LOST', 'BROKER']) {
      const l = await lead(p.name);
      const who = l.assignedExecutive.id === a.id ? callA : callB;
      assert.equal((await who(`/executive/leads/${l.id}/status`, 'PATCH', { status })).status, 200);
      await backdate(l.id, 1000);
      const before = (await row(l.id)).exec;
      await runLeadTimeoutSweep();
      assert.equal((await row(l.id)).exec, before, status);
      assert.equal((await timeouts(l.id)).length, 0, status);
    }
  });
  it('only opening the lead is not handling it: it still times out', async () => {
    const p = await t.property('Opened Only Oaks', [a.id, b.id]);
    const l = await lead(p.name); // a
    await callA(`/executive/leads/${l.id}`); // opened, status still INCOMING
    await backdate(l.id, 91);
    await runLeadTimeoutSweep();
    assert.equal((await row(l.id)).exec, b.id);
  });
  it('an admin or manager changing nothing but the star does not handle it either (see Important below)', async () => {
    const p = await t.property('Star Stays', [a.id, b.id]);
    const l = await lead(p.name);
    await backdate(l.id, 30);
    const before = await row(l.id);
    await callA(`/executive/leads/${l.id}/important`, 'POST');
    assert.equal((await row(l.id)).assigned_at.getTime(), before.assigned_at.getTime(), 'starring does not touch the timer');
    await backdate(l.id, 91);
    await runLeadTimeoutSweep();
    assert.equal((await row(l.id)).exec, b.id, 'a starred lead still times out');
  });
});

describe('timeout: manual reassignment resets the timer', () => {
  it('admin reassigns a lead that was about to time out: the clock restarts from then', async () => {
    const p = await t.property('Manual Reset Manor', [a.id, b.id]);
    const l = await lead(p.name);
    await backdate(l.id, 120);
    await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: c.id });
    assert.ok(Date.now() - (await row(l.id)).assigned_at.getTime() < 60_000);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).exec, c.id);
    // and it times out again 90 minutes after the manual assignment, away from the manual assignee
    await backdate(l.id, 91);
    await runLeadTimeoutSweep();
    const cur = await row(l.id);
    assert.notEqual(cur.exec, c.id);
    assert.deepEqual((await history(l.id)).map((h) => h.method), ['ROUND_ROBIN', 'MANUAL', 'TIMEOUT']);
  });
  it('a manager reassigning also restarts the timer', async () => {
    const mgr = (await t.call('/admin/managers')).body[0];
    const team = (await t.call('/admin/teams', 'POST', { name: 'Timeout Team', managerId: mgr.id })).body;
    await t.call(`/admin/executives/${a.id}/team`, 'PATCH', { teamId: team.id });
    await t.call(`/admin/executives/${b.id}/team`, 'PATCH', { teamId: team.id });
    const p = await t.property('Manager Reset Mews', [a.id, c.id]);
    const l = await lead(p.name); // a: a member of the manager's team
    await backdate(l.id, 120);
    assert.equal((await mgrCall(`/manager/leads/${l.id}/assign`, 'PATCH', { executiveId: b.id })).status, 200);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).exec, b.id);
  });
  it('a pending lead assigned by hand starts its own timer at that moment', async () => {
    const p = await t.property('Late Start Lodge');
    const l = await lead(p.name);
    await t.call(`/admin/leads/${l.id}/assign`, 'PATCH', { executiveId: a.id });
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0);
    assert.equal((await row(l.id)).status, 'INCOMING');
  });
});

describe('timeout: the new executive is notified', () => {
  it('the lead shows up as new for them (list, badge, polling) and disappears for the previous executive', async () => {
    const p = await t.property('Notify Nook', [a.id, b.id]);
    const l = await lead(p.name); // a
    await callA(`/executive/leads/${l.id}`); // a opened it
    assert.equal((await callA('/executive/leads?isNew=true')).body.some((x: any) => x.id === l.id), false);

    const newBefore = (await callB('/executive/leads/summary')).body.newLeads;
    const marker = new Date(Date.now() - 1000).toISOString();
    await backdate(l.id, 91);
    await runLeadTimeoutSweep();

    const mine = (await callB('/executive/leads?isNew=true')).body.find((x: any) => x.id === l.id);
    assert.ok(mine, 'new for b');
    assert.equal(mine.isNew, true);
    assert.equal(mine.assignedExecutive.id, b.id);
    assert.equal((await callB('/executive/leads/summary')).body.newLeads, newBefore + 1, 'badge count');
    assert.ok((await callB(`/executive/leads?assignedSince=${encodeURIComponent(marker)}`)).body.some((x: any) => x.id === l.id), 'polling sees it');
    assert.equal((await callA(`/executive/leads/${l.id}`)).status, 404, 'a no longer has it');
    assert.equal((await callA('/executive/leads')).body.some((x: any) => x.id === l.id), false);
    assert.equal((await callB(`/executive/leads/${l.id}`)).body.isNew, false, 'opening clears it, as usual');
  });
});

describe('timeout: the admin-configured value is what counts', () => {
  it('a shorter timeout reassigns sooner, a longer one waits longer', async () => {
    const p = await t.property('Configured Court', [a.id, b.id, c.id]);
    const l = await lead(p.name);
    await setTimeoutMinutes(10);
    await backdate(l.id, 11);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 1);
    await setTimeoutMinutes(120);
    await backdate(l.id, 91);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 0, '91 minutes is below the new 120');
    await backdate(l.id, 121);
    assert.equal((await runLeadTimeoutSweep()).reassigned, 1);
    await setTimeoutMinutes(90);
  });
});

describe('timeout: concurrency', () => {
  it('the same lead is never reassigned twice, however many sweeps race', async () => {
    const p = await t.property('Race Ridge', [a.id, b.id, c.id]);
    const l = await lead(p.name);
    await backdate(l.id, 91);
    const results = await Promise.all(Array.from({ length: 10 }, () => reassignTimedOutLead(l.id, 90)));
    assert.equal(results.filter((r) => r === 'reassigned').length, 1);
    assert.equal((await timeouts(l.id)).length, 1);
  });
  it('many leads, many simultaneous sweeps: each lead moves exactly once and the work is not duplicated', async () => {
    const p = await t.property('Busy Boulevard', [a.id, b.id, c.id]);
    const leads = [];
    for (let i = 0; i < 9; i++) leads.push(await lead(p.name));
    const originals = new Map(leads.map((l) => [l.id, l.assignedExecutive.id]));
    for (const l of leads) await backdate(l.id, 91);

    const sweeps = await Promise.all(Array.from({ length: 6 }, () => runLeadTimeoutSweep()));
    assert.equal(sweeps.reduce((s, r) => s + r.reassigned, 0), 9);
    assert.equal(sweeps.reduce((s, r) => s + r.failed, 0), 0);
    for (const l of leads) {
      assert.equal((await timeouts(l.id)).length, 1, 'one TIMEOUT row per lead');
      assert.notEqual((await row(l.id)).exec, originals.get(l.id));
    }
  });
  it('a lead handled while a sweep is racing is not reassigned', async () => {
    const p = await t.property('Handled Race Hill', [a.id, b.id]);
    const l = await lead(p.name);
    await backdate(l.id, 91);
    await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' });
    assert.equal(await reassignTimedOutLead(l.id, 90), 'skipped');
    assert.equal((await row(l.id)).exec, a.id);
  });
  it('round robin positions stay correct while timeouts happen: no two new leads share a turn', async () => {
    const p = await t.property('Mixed Meadow', [a.id, b.id, c.id]);
    const first = await lead(p.name);
    await backdate(first.id, 91);
    const [, ...rs] = await Promise.all([runLeadTimeoutSweep(), ...Array.from({ length: 9 }, () => lead(p.name))]);
    const counts = new Map<string, number>();
    for (const r of rs) counts.set(r.assignedExecutive.id, (counts.get(r.assignedExecutive.id) ?? 0) + 1);
    assert.equal(rs.every((r) => r.status === 'INCOMING'), true);
    assert.equal([...counts.values()].reduce((x, y) => x + y, 0), 9);
    assert.ok([...counts.values()].every((v) => v >= 2 && v <= 4), `fairly spread: ${JSON.stringify([...counts])}`);
  });
});

// ---- the confirmed client SLA: 90 minutes, 24/7, runs only while INCOMING, admin-editable ----

const MIN = 60_000;
const at = (iso: string, plusMinutes = 0) => new Date(new Date(iso).getTime() + plusMinutes * MIN);
/** Gives a fresh lead an exact assignment time, so the SLA can be checked at specific moments of the week. */
const assignedAt = async (leadId: string, iso: string) =>
  pool.query('UPDATE leads SET assigned_at = $2::timestamptz WHERE id = $1', [leadId, iso]);

describe('SLA: 90 minutes by default, running 24/7', () => {
  it('90 minutes is the default and there are no working-hours settings', async () => {
    await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'");
    const r = (await t.call('/admin/settings/lead-timeout')).body;
    assert.deepEqual([r.minutes, r.defaultMinutes, r.isDefault], [90, 90, true]);
    assert.deepEqual(Object.keys(r).sort(), ['defaultMinutes', 'isDefault', 'maxMinutes', 'minMinutes', 'minutes', 'updatedAt', 'updatedBy']);
  });

  it('exactly 89 minutes is not enough, 90 is, with the lead on its first executive until then', async () => {
    const p = await t.property('Ninety Nest', [a.id, b.id]);
    const l = await lead(p.name);
    const start = '2026-02-10T11:00:00Z'; // an ordinary weekday morning
    await assignedAt(l.id, start);
    assert.equal((await runLeadTimeoutSweep(500, at(start, 89))).reassigned, 0);
    assert.equal((await row(l.id)).exec, a.id);
    assert.equal((await runLeadTimeoutSweep(500, at(start, 90))).reassigned, 1);
    assert.equal((await row(l.id)).exec, b.id);
  });

  const moments: [string, string][] = [
    ['in the middle of the night', '2026-02-10T02:15:00Z'],
    ['on a Saturday', '2026-01-03T14:00:00Z'],
    ['on a Sunday night', '2026-01-04T01:30:00Z'],
    ['across midnight (Saturday 23:30 to Sunday 01:00)', '2026-01-03T23:30:00Z'],
    ['on New Year\'s Day', '2026-01-01T00:10:00Z'],
    ['on Christmas Day', '2025-12-25T03:00:00Z'],
    ['across a month end at night', '2026-01-31T23:50:00Z'],
  ];
  for (const [label, start] of moments) {
    it(`the clock keeps running ${label}: reassigned after exactly 90 minutes, not before`, async () => {
      const p = await t.property(`Always On ${label}`, [a.id, b.id, c.id]);
      const l = await lead(p.name);
      await assignedAt(l.id, start);
      assert.equal((await runLeadTimeoutSweep(500, at(start, 89))).reassigned, 0, 'not yet');
      assert.equal((await row(l.id)).exec, a.id);
      assert.equal((await runLeadTimeoutSweep(500, at(start, 90))).reassigned, 1, 'no working hours pause the clock');
      const cur = await row(l.id);
      assert.equal(cur.exec, b.id);
      assert.equal(cur.assigned_at.getTime(), at(start, 90).getTime(), 'the next 90 minutes start from the reassignment');
      assert.deepEqual((await history(l.id)).map((h) => h.method), ['ROUND_ROBIN', 'TIMEOUT']);
    });
  }

  it('it keeps going all night: a lead nobody touches rotates every 90 minutes, round robin, until morning', async () => {
    const p = await t.property('All Night Arcade', [a.id, b.id, c.id]);
    const l = await lead(p.name);
    const start = '2026-01-10T22:00:00Z'; // Saturday evening
    await assignedAt(l.id, start);
    const holders = [(await row(l.id)).exec];
    for (let i = 1; i <= 6; i++) {
      assert.equal((await runLeadTimeoutSweep(500, at(start, i * 90))).reassigned, 1, `at +${i * 90} min`);
      holders.push((await row(l.id)).exec);
    }
    assert.deepEqual(holders, [a.id, b.id, c.id, a.id, b.id, c.id, a.id]);
    assert.equal((await timeouts(l.id)).length, 6);
    assert.ok((await timeouts(l.id)).every((h) => h.assigned_by_id === null));
  });

  it('a late-night assignment times out 90 minutes later, not at the next working day', async () => {
    const p = await t.property('Night Owl Lofts', [a.id, b.id]);
    const l = await lead(p.name);
    await assignedAt(l.id, '2026-01-04T22:45:00Z'); // Sunday 22:45
    assert.equal((await runLeadTimeoutSweep(500, at('2026-01-05T00:14:00Z'))).reassigned, 0); // 89 min
    assert.equal((await runLeadTimeoutSweep(500, at('2026-01-05T00:15:00Z'))).reassigned, 1); // 90 min, Monday 00:15
  });
});

describe('SLA: it only runs while the lead is INCOMING', () => {
  it('moving to any other status stops it: nothing happens however long the lead sits', async () => {
    const p = await t.property('Stopped Stables', [a.id, b.id]);
    for (const status of ['RINGING', 'CONNECTED', 'CLOSED', 'LOST', 'BROKER']) {
      const l = await lead(p.name);
      const who = l.assignedExecutive.id === a.id ? callA : callB;
      const start = '2026-02-11T09:00:00Z';
      await assignedAt(l.id, start);
      assert.equal((await who(`/executive/leads/${l.id}/status`, 'PATCH', { status })).status, 200, status);
      const holder = (await row(l.id)).exec;
      assert.equal((await runLeadTimeoutSweep(500, at(start, 90 * 20))).reassigned >= 0, true);
      assert.equal((await row(l.id)).exec, holder, `${status}: stays put after 30 hours`);
      assert.equal((await timeouts(l.id)).length, 0, status);
    }
  });

  it('handled just before the deadline: no reassignment', async () => {
    const p = await t.property('Last Minute Lane', [a.id, b.id]);
    const l = await lead(p.name); // a
    const start = '2026-02-12T09:00:00Z';
    await assignedAt(l.id, start);
    await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'CONNECTED' }); // "at 89 minutes"
    assert.equal(await reassignTimedOutLead(l.id, 90, at(start, 91)), 'skipped');
    assert.equal((await row(l.id)).exec, a.id);
  });

  it('after a timeout move, handling it at the new executive also stops the SLA', async () => {
    const p = await t.property('Second Chance Court', [a.id, b.id, c.id]);
    const l = await lead(p.name); // a
    const start = '2026-02-12T12:00:00Z';
    await assignedAt(l.id, start);
    await runLeadTimeoutSweep(500, at(start, 90)); // -> b
    assert.equal((await row(l.id)).exec, b.id);
    await callB(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' });
    assert.equal((await runLeadTimeoutSweep(500, at(start, 90 + 500))).reassigned >= 0, true);
    assert.equal((await row(l.id)).exec, b.id);
    assert.equal((await timeouts(l.id)).length, 1);
  });

  it('a lead put back to INCOMING is measured from its assignment time (the clock is not restarted)', async () => {
    const p = await t.property('Back To Start Bay', [a.id, b.id]);
    const l = await lead(p.name); // a
    const start = '2026-02-13T10:00:00Z';
    await assignedAt(l.id, start);
    await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'RINGING' });
    await callA(`/executive/leads/${l.id}/status`, 'PATCH', { status: 'INCOMING' });
    assert.equal((await runLeadTimeoutSweep(500, at(start, 120))).reassigned, 1);
    assert.equal((await row(l.id)).exec, b.id);
  });
});

describe('SLA: the admin can change the duration for special cases', () => {
  it('a special case: 15 minutes, then back to the 90 default', async () => {
    const p = await t.property('Special Case Suites', [a.id, b.id]);
    const l = await lead(p.name);
    const start = '2026-02-14T09:00:00Z';
    await assignedAt(l.id, start);
    assert.equal((await setTimeoutMinutes(15)).body.minutes, 15);
    assert.equal((await runLeadTimeoutSweep(500, at(start, 14))).reassigned, 0);
    assert.equal((await runLeadTimeoutSweep(500, at(start, 15))).reassigned, 1);
    const back = await setTimeoutMinutes(90);
    assert.deepEqual([back.body.minutes, back.body.isDefault], [90, true]);
  });
  it('only the admin can change it; a refused change leaves the value as it was', async () => {
    const before = (await t.call('/admin/settings/lead-timeout')).body;
    assert.equal((await mgrCall('/admin/settings/lead-timeout', 'PUT', { minutes: 5 })).status, 403);
    assert.equal((await callA('/admin/settings/lead-timeout', 'PUT', { minutes: 5 })).status, 403);
    assert.equal((await t.asToken('')('/admin/settings/lead-timeout', 'PUT', { minutes: 5 })).status, 401);
    assert.deepEqual((await t.call('/admin/settings/lead-timeout')).body, before);
  });
});

describe('SLA: concurrency at the 90-minute mark', () => {
  it('many sweeps racing at the same instant reassign each due lead exactly once', async () => {
    const p = await t.property('Deadline Docks', [a.id, b.id, c.id]);
    const start = '2026-02-15T03:00:00Z';
    const leads = [];
    for (let i = 0; i < 6; i++) leads.push(await lead(p.name));
    for (const l of leads) await assignedAt(l.id, start);
    const sweeps = await Promise.all(Array.from({ length: 8 }, () => runLeadTimeoutSweep(500, at(start, 90))));
    assert.equal(sweeps.reduce((n, r) => n + r.reassigned, 0), 6);
    for (const l of leads) assert.equal((await timeouts(l.id)).length, 1);
  });
});

describe('migration 014: the default moves from 60 to 90 without overriding an admin\'s choice', () => {
  const up = () => {
    const sql = readFileSync(join(__dirname, '..', 'migrations', '014_lead_sla_default_90.sql'), 'utf8');
    return sql.split('-- Down Migration')[0];
  };
  const value = async () => (await pool.query("SELECT value FROM app_settings WHERE key = 'lead_timeout_minutes'")).rows[0]?.value;

  it('an untouched 60 (the old seed) becomes 90', async () => {
    await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'");
    await pool.query("INSERT INTO app_settings (key, value) VALUES ('lead_timeout_minutes', '60')");
    await pool.query(up());
    assert.equal(await value(), '90');
  });
  it('a value an admin saved is kept, even when it is 60', async () => {
    const admin = (await pool.query("SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1")).rows[0].id;
    for (const v of ['60', '45', '120']) {
      await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'");
      await pool.query("INSERT INTO app_settings (key, value, updated_by_id) VALUES ('lead_timeout_minutes', $1, $2)", [v, admin]);
      await pool.query(up());
      assert.equal(await value(), v, `admin's ${v} stays`);
    }
  });
  it('a missing row is created with 90', async () => {
    await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'");
    await pool.query(up());
    assert.equal(await value(), '90');
    await pool.query("DELETE FROM app_settings WHERE key = 'lead_timeout_minutes'"); // leave the code default in force
  });
});
