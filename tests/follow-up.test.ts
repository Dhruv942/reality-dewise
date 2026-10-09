import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { followUpState } from '../src/modules/leads/lead.model';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let amit: any, rahul: any, mgr: any, outsider: any;
let amitCall: ReturnType<typeof t.asToken>, rahulCall: ReturnType<typeof t.asToken>;
let mgrCall: ReturnType<typeof t.asToken>, outCall: ReturnType<typeof t.asToken>;
let mine: any, theirs: any, pending: any;

const lead = (extra: object = {}) =>
  t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, propertyName: 'FU Towers', source: '99ACRES', ...extra });
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const row = async (id: string) => (await pool.query('SELECT * FROM leads WHERE id = $1', [id])).rows[0];
/** Writes a follow-up straight to the database (past times cannot be set through the API). */
const force = (id: string, at: string | null) => pool.query('UPDATE leads SET follow_up_at = $2 WHERE id = $1', [id, at]);

before(async () => {
  t = await startTestApp();
  mgr = await t.manager('fu.mgr');
  const teamA = (await t.call('/admin/teams', 'POST', { name: 'FU Team', managerId: mgr.id })).body;
  outsider = await t.manager('fu.out');
  amit = await t.exec('fu.amit', teamA.id);
  rahul = await t.exec('fu.rahul');
  await t.property('FU Towers', [amit.id]);
  await t.property('FU Other', [rahul.id]);
  await t.property('FU Empty');
  amitCall = t.asToken(await t.login('executive', 'fu.amit@test.com', 'TempPass123'));
  rahulCall = t.asToken(await t.login('executive', 'fu.rahul@test.com', 'TempPass123'));
  mgrCall = t.asToken(await t.login('manager', 'fu.mgr@test.com', 'TempPass123'));
  outCall = t.asToken(await t.login('manager', 'fu.out@test.com', 'TempPass123'));
  mine = (await lead()).body; // amit
  theirs = (await lead({ propertyName: 'FU Other' })).body; // rahul
  pending = (await lead({ propertyName: 'FU Empty' })).body; // nobody
});
after(() => t.close());

describe('follow-up state', () => {
  const now = new Date('2026-10-09T10:00:00Z');
  it('classifies overdue, today and upcoming', () => {
    assert.equal(followUpState(new Date('2026-10-09T09:59:00Z'), now), 'OVERDUE');
    assert.equal(followUpState(new Date('2026-10-09T10:00:00Z'), now), 'OVERDUE');
    assert.equal(followUpState(new Date('2026-10-09T23:59:00Z'), now), 'TODAY');
    assert.equal(followUpState(new Date('2026-10-10T00:00:00Z'), now), 'UPCOMING');
  });
  it('"today" follows the given timezone', () => {
    const at = new Date('2026-10-09T20:00:00Z'); // 01:30 on the 10th in Kolkata
    assert.equal(followUpState(at, now, 'UTC'), 'TODAY');
    assert.equal(followUpState(at, now, 'Asia/Kolkata'), 'UPCOMING');
  });
});

describe('follow-up: set, update, clear', () => {
  it('a new lead has no follow-up', async () => {
    assert.equal(mine.followUp, null);
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.followUp, null);
  });

  it('executive sets it on their own lead; it persists and shows who set it', async () => {
    const at = inHours(48);
    const r = await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: at, followUpNote: ' Call about the loan ' });
    assert.equal(r.status, 200);
    assert.equal(new Date(r.body.followUp.at).getTime(), new Date(at).getTime());
    assert.equal(r.body.followUp.note, 'Call about the loan');
    assert.equal(r.body.followUp.state, 'UPCOMING');
    assert.deepEqual(r.body.followUp.updatedBy, { id: amit.id, name: 'Fu.amit' });
    assert.ok(r.body.followUp.updatedAt);
    // "after refresh": a fresh read in detail and in every list shows the same thing
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.followUp.note, 'Call about the loan');
    assert.equal((await amitCall('/executive/leads')).body.find((l: any) => l.id === mine.id).followUp.note, 'Call about the loan');
    assert.equal((await t.call(`/admin/leads/${mine.id}`)).body.followUp.updatedBy.id, amit.id);
    assert.equal((await mgrCall(`/manager/leads/${mine.id}`)).body.followUp.note, 'Call about the loan');
  });

  it('it can be changed, and the last editor is recorded', async () => {
    const at = inHours(72);
    const r = await mgrCall(`/manager/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: at });
    assert.equal(r.status, 200);
    assert.equal(r.body.followUp.note, null);
    assert.equal(r.body.followUp.updatedBy.id, mgr.id);
    assert.equal((await row(mine.id)).follow_up_updated_by, mgr.id);
  });

  it('admin can set it on any lead, including one nobody is assigned to', async () => {
    for (const l of [theirs, pending]) {
      const r = await t.call(`/admin/leads/${l.id}/follow-up`, 'PUT', { followUpAt: inHours(24) });
      assert.equal(r.status, 200);
      assert.equal(r.body.followUp.updatedBy.name, 'Admin');
    }
  });

  it('PUT with followUpAt null clears it (and the note); the editor and time are kept', async () => {
    await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(5), followUpNote: 'x' });
    const r = await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: null, followUpNote: 'ignored' });
    assert.equal(r.status, 200);
    assert.equal(r.body.followUp, null);
    const db = await row(mine.id);
    assert.equal(db.follow_up_at, null);
    assert.equal(db.follow_up_note, null);
    assert.equal(db.follow_up_updated_by, amit.id);
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.followUp, null);
  });

  it('DELETE clears it too', async () => {
    await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(5) });
    const r = await amitCall(`/executive/leads/${mine.id}/follow-up`, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(r.body.followUp, null);
  });

  it('accepts a time with a non-UTC offset and stores the same instant', async () => {
    const r = await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: '2099-01-01T10:30:00+05:30' });
    assert.equal(new Date(r.body.followUp.at).toISOString(), '2099-01-01T05:00:00.000Z');
    await amitCall(`/executive/leads/${mine.id}/follow-up`, 'DELETE');
  });
});

describe('follow-up: permissions', () => {
  it('an executive cannot touch a lead assigned to someone else (404, nothing written)', async () => {
    const r = await amitCall(`/executive/leads/${theirs.id}/follow-up`, 'PUT', { followUpAt: inHours(9) });
    assert.equal(r.status, 404);
    assert.equal((await amitCall(`/executive/leads/${theirs.id}/follow-up`, 'DELETE')).status, 404);
    assert.equal((await row(theirs.id)).follow_up_updated_by !== amit.id, true);
  });

  it('a manager is limited to their team scope; an outsider manager cannot touch the team\'s lead', async () => {
    assert.equal((await mgrCall(`/manager/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 200);
    assert.equal((await outCall(`/manager/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 404);
    assert.equal((await outCall(`/manager/leads/${mine.id}/follow-up`, 'DELETE')).status, 404);
    // a lead in a team they don't lead
    assert.equal((await mgrCall(`/manager/leads/${theirs.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 404);
  });

  it('a manager can schedule an unassigned lead (it is in their scope)', async () => {
    assert.equal((await mgrCall(`/manager/leads/${pending.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 200);
  });

  it('unknown leads are 404, and a missing or wrong-role token is rejected', async () => {
    assert.equal((await t.call(`/admin/leads/${ZERO}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 404);
    assert.equal((await t.asToken('')(`/admin/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 401);
    assert.equal((await amitCall(`/admin/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 403);
    assert.equal((await rahulCall(`/manager/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(9) })).status, 403);
  });
});

describe('follow-up: validation', () => {
  const put = (body: unknown) => amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', body);
  before(() => force(mine.id, null));
  it('rejects malformed payloads with 400 and writes nothing', async () => {
    const bad: unknown[] = [
      {},
      { followUpAt: 'tomorrow' },
      { followUpAt: '2099-01-01' },
      { followUpAt: '2099-01-01T10:00:00' }, // no offset
      { followUpAt: '2099-13-45T10:00:00Z' },
      { followUpAt: 12345 },
      { followUpAt: inHours(5), followUpNote: 'n'.repeat(501) },
      { followUpAt: inHours(5), followUpNote: 5 },
      { followUpAt: inHours(5), extra: 1 },
      { followUpAt: inHours(5), followUpNote: 'a\u0000b' },
    ];
    for (const body of bad) assert.equal((await put(body)).status, 400, JSON.stringify(body));
    assert.equal((await row(mine.id)).follow_up_at, null);
  });

  it('rejects a time in the past', async () => {
    const r = await put({ followUpAt: inHours(-1) });
    assert.equal(r.status, 400);
    assert.equal(r.body.errors[0].field, 'followUpAt');
  });

  it('keeping an already-overdue time is allowed, so its note can still be edited', async () => {
    const past = inHours(-3);
    await force(mine.id, past);
    const r = await put({ followUpAt: past, followUpNote: 'still chasing' });
    assert.equal(r.status, 200);
    assert.equal(r.body.followUp.state, 'OVERDUE');
    assert.equal(r.body.followUp.note, 'still chasing');
    assert.equal((await put({ followUpAt: inHours(-2) })).status, 400, 'moving it to another past time is not');
    assert.equal((await put({ followUpAt: null })).status, 200);
  });

  it('rejects an invalid tz', async () => {
    assert.equal((await amitCall(`/executive/leads/${mine.id}/follow-up?tz=Mars/Base`, 'PUT', { followUpAt: inHours(5) })).status, 400);
    assert.equal((await amitCall('/executive/leads?tz=Nope')).status, 400);
    assert.equal((await amitCall('/executive/leads?followUp=later')).status, 400);
  });
});

describe('follow-up: states and filters', () => {
  const ids = async (path: string, call = t.call) => (await call(path)).body.map((l: any) => l.id) as string[];
  let overdue: any, today: any, upcoming: any, none: any;
  before(async () => {
    [overdue, today, upcoming, none] = await Promise.all([lead(), lead(), lead(), lead()].map(async (p) => (await p).body));
    await force(overdue.id, inHours(-5));
    await force(upcoming.id, inHours(24 * 5));
    // "today" = later today in UTC; use the last minute of the day, and skip the check if it is already past (run at 23:59 UTC)
    const endOfDay = new Date(); endOfDay.setUTCHours(23, 59, 0, 0);
    await force(today.id, endOfDay.toISOString());
  });

  it('each lead reports its state', async () => {
    const byId = new Map((await t.call('/admin/leads?limit=200')).body.map((l: any) => [l.id, l]));
    assert.equal((byId.get(overdue.id) as any).followUp.state, 'OVERDUE');
    assert.equal((byId.get(upcoming.id) as any).followUp.state, 'UPCOMING');
    assert.equal((byId.get(none.id) as any).followUp, null);
    if (Date.now() < new Date().setUTCHours(23, 59, 0, 0)) assert.equal((byId.get(today.id) as any).followUp.state, 'TODAY');
  });

  it('?followUp= filters each bucket', async () => {
    const o = await ids('/admin/leads?followUp=overdue&limit=200');
    assert.ok(o.includes(overdue.id) && !o.includes(upcoming.id) && !o.includes(none.id));
    const u = await ids('/admin/leads?followUp=upcoming&limit=200');
    assert.ok(u.includes(upcoming.id) && !u.includes(overdue.id) && !u.includes(none.id));
    const n = await ids('/admin/leads?followUp=none&limit=200');
    assert.ok(n.includes(none.id) && !n.includes(overdue.id) && !n.includes(upcoming.id));
    if (Date.now() < new Date().setUTCHours(23, 59, 0, 0)) {
      const d = await ids('/admin/leads?followUp=today&limit=200');
      assert.ok(d.includes(today.id) && !d.includes(overdue.id) && !d.includes(upcoming.id));
    }
  });

  it('the filter and state honour tz for "today"', async () => {
    // An instant that is "later today" in the zone where the day is longest from now, but "tomorrow" in UTC when possible.
    const zone = 'Pacific/Kiritimati'; // UTC+14
    const nowDay = new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
    const at = new Date(`${nowDay}T23:59:00+14:00`);
    if (at.getTime() <= Date.now()) return; // that minute already passed in that zone
    await force(none.id, at.toISOString());
    const inZone = await ids(`/admin/leads?followUp=today&tz=${zone}&limit=200`);
    assert.ok(inZone.includes(none.id));
    const dto = (await t.call(`/admin/leads/${none.id}?tz=${zone}`)).body;
    assert.equal(dto.followUp.state, 'TODAY');
    await force(none.id, null);
  });

  it('works in the executive and manager lists, scoped as usual', async () => {
    await force(mine.id, inHours(-1));
    assert.ok((await ids('/executive/leads?followUp=overdue', amitCall)).includes(mine.id));
    assert.ok((await ids('/manager/leads?followUp=overdue', mgrCall)).includes(mine.id));
    assert.ok(!(await ids('/executive/leads?followUp=overdue', rahulCall)).includes(mine.id));
    await force(mine.id, null);
  });
});

describe('follow-up does not affect assignment or SLA', () => {
  it('setting, changing and clearing leave status, executive, assignedAt, SLA and activity untouched', async () => {
    const before = (await t.call(`/admin/leads/${mine.id}`)).body;
    await amitCall(`/executive/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(30), followUpNote: 'n' });
    await mgrCall(`/manager/leads/${mine.id}/follow-up`, 'PUT', { followUpAt: inHours(31) });
    await t.call(`/admin/leads/${mine.id}/follow-up`, 'DELETE');
    const after = (await t.call(`/admin/leads/${mine.id}`)).body;
    for (const k of ['status', 'assignedExecutive', 'assignedAt', 'isNew', 'activity', 'customerHistory']) assert.deepEqual(after[k], before[k], k);
    assert.equal(after.sla?.deadline, before.sla?.deadline);
  });

  it('an overdue follow-up does not change the lead on the SLA sweep or status flows', async () => {
    await force(mine.id, inHours(-10));
    const { runLeadTimeoutSweep } = await import('../src/modules/leads/lead.service');
    await runLeadTimeoutSweep(500); // the SLA (90 min) has not expired for this lead, so nothing moves
    const r = await amitCall(`/executive/leads/${mine.id}/status`, 'PATCH', { status: 'RINGING' });
    assert.equal(r.status, 200);
    assert.equal(r.body.assignedExecutive.id, amit.id);
    assert.equal(r.body.followUp.state, 'OVERDUE', 'a status change leaves the follow-up as it was');
  });

  it('reassigning a lead keeps its follow-up', async () => {
    const r = await t.call(`/admin/leads/${mine.id}/assign`, 'PATCH', { executiveId: rahul.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.followUp.state, 'OVERDUE');
  });
});
