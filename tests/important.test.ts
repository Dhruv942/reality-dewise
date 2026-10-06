import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let amit: any, rahul: any, mgr: any, outsider: any;
let amitCall: ReturnType<typeof t.asToken>, rahulCall: ReturnType<typeof t.asToken>;
let mgrCall: ReturnType<typeof t.asToken>, outCall: ReturnType<typeof t.asToken>;
let mine: any, theirs: any, pending: any;

const lead = (extra: object = {}) =>
  t.call('/admin/leads', 'POST', { name: 'Buyer', mobile: `98${Math.floor(10000000 + Math.random() * 89999999)}`, propertyName: 'Imp Towers', source: '99ACRES', ...extra });
const flagIn = (list: any[], id: string) => list.find((l) => l.id === id)?.isImportant;

before(async () => {
  t = await startTestApp();
  const teamA = (await (async () => { mgr = await t.manager('imp.mgr'); return t.call('/admin/teams', 'POST', { name: 'Imp Team', managerId: mgr.id }); })()).body;
  outsider = await t.manager('imp.out');
  amit = await t.exec('imp.amit', teamA.id);
  rahul = await t.exec('imp.rahul');
  await t.property('Imp Towers', [amit.id]);
  await t.property('Imp Other', [rahul.id]);
  await t.property('Imp Empty');
  amitCall = t.asToken(await t.login('executive', 'imp.amit@test.com', 'TempPass123'));
  rahulCall = t.asToken(await t.login('executive', 'imp.rahul@test.com', 'TempPass123'));
  mgrCall = t.asToken(await t.login('manager', 'imp.mgr@test.com', 'TempPass123'));
  outCall = t.asToken(await t.login('manager', 'imp.out@test.com', 'TempPass123'));
  mine = (await lead()).body; // amit
  theirs = (await lead({ propertyName: 'Imp Other' })).body; // rahul
  pending = (await lead({ propertyName: 'Imp Empty' })).body; // nobody
});
after(() => t.close());

describe('important lead (per user)', () => {
  it('every lead starts as not important, in lists and in detail', async () => {
    assert.equal(mine.isImportant, false, 'create response');
    assert.equal(flagIn((await amitCall('/executive/leads')).body, mine.id), false);
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.isImportant, false);
    assert.equal(flagIn((await t.call('/admin/leads?limit=200')).body, mine.id), false);
  });

  it('POST marks it important for the logged-in user and returns the lead', async () => {
    const r = await amitCall(`/executive/leads/${mine.id}/important`, 'POST');
    assert.equal(r.status, 200);
    assert.equal(r.body.id, mine.id);
    assert.equal(r.body.isImportant, true);
    assert.equal(flagIn((await amitCall('/executive/leads')).body, mine.id), true, 'list');
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.isImportant, true, 'detail');
  });

  it('it persists: stored in the database and returned after logging in again from another device', async () => {
    assert.equal((await pool.query('SELECT count(*)::int n FROM lead_important WHERE user_id=$1 AND lead_id=$2', [amit.id, mine.id])).rows[0].n, 1);
    const otherDevice = t.asToken(await t.login('executive', 'imp.amit@test.com', 'TempPass123'));
    assert.equal(flagIn((await otherDevice('/executive/leads')).body, mine.id), true);
    assert.equal((await otherDevice(`/executive/leads/${mine.id}`)).body.isImportant, true);
  });

  it('it is personal: another user\'s list is not affected, and each user keeps their own flag', async () => {
    assert.equal(flagIn((await t.call('/admin/leads?limit=200')).body, mine.id), false, 'admin does not see amit\'s flag');
    assert.equal(flagIn((await mgrCall('/manager/leads?limit=200')).body, mine.id), false, 'manager does not either');
    assert.equal((await t.call(`/admin/leads/${mine.id}`)).body.isImportant, false);

    assert.equal((await t.call(`/admin/leads/${mine.id}/important`, 'POST')).body.isImportant, true);
    assert.equal(flagIn((await t.call('/admin/leads?limit=200')).body, mine.id), true);
    assert.equal(flagIn((await amitCall('/executive/leads')).body, mine.id), true);

    await amitCall(`/executive/leads/${mine.id}/important`, 'DELETE');
    assert.equal(flagIn((await amitCall('/executive/leads')).body, mine.id), false, 'amit unmarked');
    assert.equal(flagIn((await t.call('/admin/leads?limit=200')).body, mine.id), true, 'admin still has it');
    await t.call(`/admin/leads/${mine.id}/important`, 'DELETE');
  });

  it('DELETE removes it, and both calls are idempotent (a toggle in the UI is POST or DELETE by current state)', async () => {
    const url = `/executive/leads/${mine.id}/important`;
    assert.equal((await amitCall(url, 'DELETE')).body.isImportant, false, 'unmarking a lead that is not important is fine');
    assert.equal((await amitCall(url, 'POST')).body.isImportant, true);
    assert.equal((await amitCall(url, 'POST')).body.isImportant, true, 'marking twice does not error or duplicate');
    assert.equal((await pool.query('SELECT count(*)::int n FROM lead_important WHERE user_id=$1 AND lead_id=$2', [amit.id, mine.id])).rows[0].n, 1);
    assert.equal((await amitCall(url, 'DELETE')).body.isImportant, false);
    assert.equal(flagIn((await amitCall('/executive/leads')).body, mine.id), false);
    assert.equal((await amitCall(url, 'POST')).body.isImportant, true, 'can be marked again');
  });

  it('?important=true / false filters the list for the logged-in user', async () => {
    const second = (await lead()).body; // amit
    assert.deepEqual((await amitCall('/executive/leads?important=true')).body.map((l: any) => l.id), [mine.id]);
    assert.deepEqual((await amitCall('/executive/leads?important=false')).body.map((l: any) => l.id), [second.id]);
    assert.equal((await rahulCall('/executive/leads?important=true')).body.length, 0, "rahul has marked nothing");
    assert.equal((await t.call('/admin/leads?important=true&limit=200')).body.length, 0, 'admin has marked nothing');
    assert.equal((await amitCall('/executive/leads?important=maybe')).status, 400);
  });

  it('the flag follows the user everywhere a lead is returned: status change, assignment, history', async () => {
    assert.equal((await amitCall(`/executive/leads/${mine.id}/status`, 'PATCH', { status: 'RINGING' })).body.isImportant, true);
    // client history: a second enquiry from the same client shows the flag of the earlier one, for this user only
    const mobile = '9877700001';
    const first = (await lead({ mobile })).body;
    const second = (await lead({ mobile })).body;
    await amitCall(`/executive/leads/${first.id}/important`, 'POST');
    const hist = (await amitCall(`/executive/leads/${second.id}`)).body.customerHistory;
    assert.equal(hist.find((h: any) => h.id === first.id).isImportant, true);
    const asAdmin = (await t.call(`/admin/leads/${second.id}`)).body.customerHistory;
    assert.equal(asAdmin.find((h: any) => h.id === first.id).isImportant, false);
    // admin assigning the lead keeps showing the admin's own view
    await t.call(`/admin/leads/${first.id}/important`, 'POST');
    assert.equal((await t.call(`/admin/leads/${first.id}/assign`, 'PATCH', { executiveId: amit.id })).body.isImportant, true);
    // client detail (admin) shows the admin's flags
    const client = (await t.call('/admin/customers?search=9877700001')).body[0];
    const detail = (await t.call(`/admin/customers/${client.id}`)).body;
    assert.equal(detail.leads.find((l: any) => l.id === first.id).isImportant, true);
    assert.equal(detail.leads.find((l: any) => l.id === second.id).isImportant, false);
  });

  it('a retried external lead returns the existing lead with the caller\'s own flag', async () => {
    const a = (await lead({ externalLeadId: 'IMP-1' })).body;
    await t.call(`/admin/leads/${a.id}/important`, 'POST');
    const again = await lead({ externalLeadId: 'IMP-1' });
    assert.equal(again.status, 200);
    assert.equal(again.body.isImportant, true);
  });
});

describe('important lead: access rules', () => {
  it('a sales user can only mark their own leads (another\'s lead is 404, nothing stored)', async () => {
    assert.equal((await amitCall(`/executive/leads/${theirs.id}/important`, 'POST')).status, 404);
    assert.equal((await amitCall(`/executive/leads/${theirs.id}/important`, 'DELETE')).status, 404);
    assert.equal((await pool.query('SELECT count(*)::int n FROM lead_important WHERE lead_id=$1', [theirs.id])).rows[0].n, 0);
    assert.equal((await rahulCall(`/executive/leads/${theirs.id}/important`, 'POST')).body.isImportant, true);
  });
  it('a manager can mark leads in their scope (their team or unassigned) but not other teams\' leads', async () => {
    assert.equal((await mgrCall(`/manager/leads/${mine.id}/important`, 'POST')).body.isImportant, true);
    assert.equal((await mgrCall(`/manager/leads/${pending.id}/important`, 'POST')).body.isImportant, true, 'unassigned lead');
    assert.equal((await mgrCall(`/manager/leads/${theirs.id}/important`, 'POST')).status, 404, "another team's lead");
    assert.equal((await outCall(`/manager/leads/${mine.id}/important`, 'POST')).status, 404, 'manager without that team');
    assert.deepEqual((await mgrCall('/manager/leads?important=true&limit=200')).body.map((l: any) => l.id).sort(), [mine.id, pending.id].sort());
    assert.equal(flagIn((await amitCall('/executive/leads')).body, pending.id) ?? false, false);
  });
  it('an admin can mark any lead', async () => {
    assert.equal((await t.call(`/admin/leads/${theirs.id}/important`, 'POST')).body.isImportant, true);
    assert.equal((await t.call(`/admin/leads/${pending.id}/important`, 'POST')).body.isImportant, true);
  });
  it('a lead reassigned away is no longer reachable by the old executive, and their flag is kept for if it returns', async () => {
    await t.call(`/admin/leads/${mine.id}/assign`, 'PATCH', { executiveId: rahul.id });
    assert.equal((await amitCall(`/executive/leads/${mine.id}/important`, 'POST')).status, 404);
    assert.equal(flagIn((await rahulCall('/executive/leads')).body, mine.id), false, "rahul never marked it");
    await t.call(`/admin/leads/${mine.id}/assign`, 'PATCH', { executiveId: amit.id });
    assert.equal((await amitCall(`/executive/leads/${mine.id}`)).body.isImportant, true);
  });
  it('validation and auth: unknown lead 404, bad id 400, no token 401, wrong portal 403', async () => {
    assert.equal((await amitCall(`/executive/leads/${ZERO}/important`, 'POST')).status, 404);
    assert.equal((await amitCall('/executive/leads/not-a-uuid/important', 'POST')).status, 400);
    assert.equal((await t.asToken('')(`/executive/leads/${mine.id}/important`, 'POST')).status, 401);
    assert.equal((await amitCall(`/admin/leads/${mine.id}/important`, 'POST')).status, 403);
    assert.equal((await amitCall(`/manager/leads/${mine.id}/important`, 'POST')).status, 403);
    assert.equal((await mgrCall(`/executive/leads/${mine.id}/important`, 'POST')).status, 403);
  });
  void outsider;
});
