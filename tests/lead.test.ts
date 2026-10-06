import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { normalizeMobile } from '../src/utils/mobile';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let team: any, amit: any, rahul: any, priya: any, prop: any, prop2: any;
let amitCall: ReturnType<typeof t.asToken>;
let rahulCall: ReturnType<typeof t.asToken>;

const enquire = (extra: object = {}) =>
  t.call('/admin/leads', 'POST', { name: 'Ravi Kumar', mobile: '9876543210', email: 'Ravi@Mail.com', propertyName: prop.name, source: '99ACRES', message: 'Interested in 2 BHK', budget: 8000000, ...extra });

before(async () => {
  t = await startTestApp();
  team = await t.team('Team A');
  amit = await t.exec('amit', team.id);
  rahul = await t.exec('rahul', team.id);
  priya = await t.exec('priya', team.id);
  prop = await t.property('XYZ Residency', [amit.id, rahul.id, priya.id]);
  prop2 = await t.property('ABC Heights', [rahul.id]);
  amitCall = t.asToken(await t.login('executive', 'amit@test.com', 'TempPass123'));
  rahulCall = t.asToken(await t.login('executive', 'rahul@test.com', 'TempPass123'));
});
after(() => t.close());

describe('mobile normalisation', () => {
  it('maps every common format to one canonical number', () => {
    for (const v of ['9876543210', '98765 43210', '+91 98765-43210', '09876543210', '919876543210', '(98765) 43210']) {
      assert.equal(normalizeMobile(v), '+919876543210', v);
    }
    assert.equal(normalizeMobile('+14155550123'), '+14155550123');
  });
  it('rejects garbage', () => {
    for (const v of ['abc', '12345', '', '98765 43210 ext 5', '++919876543210', '+1234567']) assert.equal(normalizeMobile(v), null, v);
  });
});

describe('create lead (admin)', () => {
  let first: any;
  it('creates customer + lead on the existing property and round-robins its executives', async () => {
    const r = await enquire();
    assert.equal(r.status, 201);
    first = r.body;
    assert.equal(first.status, 'INCOMING');
    assert.equal(first.customer.name, 'Ravi Kumar');
    assert.equal(first.customer.mobile, '+919876543210');
    assert.equal(first.customer.email, 'ravi@mail.com');
    assert.equal(first.property.id, prop.id, 'stored against the existing propertyId');
    assert.equal(first.property.name, 'XYZ Residency');
    assert.equal(first.source, '99ACRES');
    assert.equal(first.budget, 8000000);
    assert.equal(first.requestedPropertyName, 'XYZ Residency');
    assert.equal(first.message, 'Interested in 2 BHK');
    assert.equal(first.assignedExecutive.id, amit.id);
    assert.equal('notice' in first, false);
    assert.ok(first.createdAt);
  });
  it('next leads rotate Rahul, Priya, Amit; matching ignores case/spacing; no property is created', async () => {
    const ids = [];
    for (const [i, name] of ['xyz residency', '  XYZ   Residency ', 'XYZ RESIDENCY'].entries()) {
      const r = await enquire({ mobile: `900000000${i}`, propertyName: name });
      assert.equal(r.status, 201);
      ids.push(r.body.assignedExecutive.id);
    }
    assert.deepEqual(ids, [rahul.id, priya.id, amit.id]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM properties')).rows[0].n, 2);
  });
  it('assignment history references the real lead', async () => {
    const h = await t.call(`/admin/properties/${prop.id}/assignment-history`);
    assert.ok(h.body.history.some((x: any) => x.leadId === first.id));
  });
  it('same customer enquiring again reuses the customer but creates a new lead; source is per lead', async () => {
    const r = await enquire({ mobile: '+91 98765 43210', name: 'Someone Else', propertyName: prop2.name, source: 'MAGICBRICKS' });
    assert.equal(r.status, 201);
    assert.equal(r.body.customer.id, first.customer.id);
    assert.equal(r.body.customer.name, 'Ravi Kumar', 'existing customer name is kept');
    assert.equal(r.body.property.id, prop2.id);
    assert.equal(r.body.source, 'MAGICBRICKS');
    assert.equal((await pool.query("SELECT count(*)::int n FROM customers WHERE mobile='+919876543210'")).rows[0].n, 1);
    const same = await enquire({ mobile: '9000000077', source: 'MAGICBRICKS' });
    assert.equal(same.body.property.id, prop.id, 'the same property from the other portal is the same property');
  });
  it('validation: mobile, name, email, property name, source, budget, extra fields', async () => {
    for (const bad of [{ mobile: '123' }, { mobile: undefined }, { name: '' }, { email: 'nope' }, { propertyName: '' }, { propertyName: undefined }, { source: undefined }, { source: 'OLX' }, { budget: -5 }, { budget: '80 Lakh' }, { propertyId: prop.id }, { role: 'ADMIN' }]) {
      const r = await enquire(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
  });
  it('inactive property is rejected and NOTHING is stored', async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM customers)::int c, (SELECT count(*) FROM leads)::int l, (SELECT count(*) FROM properties)::int p')).rows[0];
    const off = await t.property('Off', [amit.id], false);
    const r = await enquire({ mobile: '9111111111', propertyName: off.name });
    assert.equal(r.status, 409);
    const after = (await pool.query('SELECT (SELECT count(*) FROM customers)::int c, (SELECT count(*) FROM leads)::int l, (SELECT count(*) FROM properties)::int p')).rows[0];
    assert.deepEqual(after, { ...before, p: before.p + 1 }, 'only the property inserted by the test itself is new');
  });
});

describe('property without executives: stub + PENDING_ASSIGNMENT', () => {
  it('unknown property name -> ONE stub property, lead saved as PENDING_ASSIGNMENT with the notice', async () => {
    const r = await enquire({ mobile: '9555555551', propertyName: 'Green Valley Residency' });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, 'PENDING_ASSIGNMENT');
    assert.equal(r.body.assignedExecutive, null);
    assert.equal(r.body.notice, 'No executive/team is assigned to Green Valley Residency. Please assign an executive/team before processing this lead.');
    const props = (await t.call('/admin/properties?search=green')).body;
    assert.equal(props.length, 1);
    assert.equal(props[0].isStub, true);
  });
  it('more leads for it reuse the property (even in parallel) and stay pending', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => enquire({ mobile: `95555555${60 + i}`, propertyName: ' green valley  residency' })));
    assert.ok(rs.every((r) => r.status === 201 && r.body.status === 'PENDING_ASSIGNMENT'));
    assert.equal((await t.call('/admin/properties?search=green')).body.length, 1);
    assert.equal((await t.call('/admin/properties?search=green')).body[0].pendingLeadCount, 7);
  });
  it('pending leads are listed by status, hidden from executives, and cannot be given a pipeline status', async () => {
    const pending = (await t.call('/admin/leads?status=PENDING_ASSIGNMENT&limit=200')).body;
    assert.equal(pending.length, 7);
    const r = await t.call(`/admin/leads/${pending[0].id}/status`, 'PATCH', { status: 'RINGING' });
    assert.equal(r.status, 409);
    assert.equal((await t.call(`/admin/leads/${pending[0].id}/status`, 'PATCH', { status: 'PENDING_ASSIGNMENT' })).status, 400);
    assert.ok(!(await amitCall('/executive/leads?limit=200')).body.some((l: any) => l.status === 'PENDING_ASSIGNMENT'));
  });
  it('all picked executives unavailable -> pending as well', async () => {
    const solo = await t.exec('solo');
    const p = await t.property('Solo Towers', [solo.id]);
    await t.setActive(solo.id, false);
    const r = await enquire({ mobile: '9555555599', propertyName: p.name });
    assert.equal(r.body.status, 'PENDING_ASSIGNMENT');
    await t.setActive(solo.id, true);
  });
  it('assigning executives to the property assigns the pending leads', async () => {
    const p = (await t.call('/admin/properties?search=green')).body[0];
    const r = await t.call(`/admin/properties/${p.id}/executives`, 'PUT', { executiveIds: [priya.id, amit.id] });
    assert.equal(r.body.assignedPendingLeads, 7);
    const leads = (await t.call(`/admin/leads?propertyId=${p.id}&limit=200`)).body;
    assert.ok(leads.every((l: any) => l.status === 'INCOMING' && [priya.id, amit.id].includes(l.assignedExecutive.id)));
    assert.equal((await t.call('/admin/leads?status=PENDING_ASSIGNMENT&limit=200')).body.some((l: any) => l.property.id === p.id), false);
    const next = await enquire({ mobile: '9555555500', propertyName: 'Green Valley Residency' });
    assert.equal(next.body.status, 'INCOMING', 'future leads follow round-robin straight away');
  });
});

describe('external lead id (idempotent retries)', () => {
  it('same (source, externalLeadId) returns the existing lead and does not rotate or duplicate', async () => {
    const a = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyName: prop2.name });
    const b = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyName: prop2.name });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leads WHERE external_lead_id='EXT-1'`)).rows[0].n, 1);
  });
  it('parallel duplicates create exactly one lead', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => enquire({ mobile: '9444444444', externalLeadId: 'EXT-2', propertyName: prop2.name })));
    assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leads WHERE external_lead_id='EXT-2'`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM property_assignment_history WHERE lead_id=$1`, [rs[0].body.id])).rows[0].n, 1);
  });
  it('the same external id from another source is a different lead', async () => {
    const r = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyName: prop2.name, source: 'MAGICBRICKS' }); // EXT-1 was first used with 99ACRES
    assert.equal(r.status, 201);
  });
});

describe('parallel enquiries', () => {
  it('30 simultaneous enquiries spread evenly across the property executives', async () => {
    const es = [await t.exec('cc.a'), await t.exec('cc.b'), await t.exec('cc.c')];
    const p = await t.property('Conc', es.map((e) => e.id));
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => enquire({ mobile: `98000${String(i).padStart(5, '0')}`, propertyName: p.name })));
    assert.ok(rs.every((r) => r.status === 201));
    for (const e of es) assert.equal(rs.filter((r) => r.body.assignedExecutive.id === e.id).length, 10);
  });
  it('30 simultaneous enquiries for a brand-new property create it exactly once', async () => {
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => enquire({ mobile: `97000${String(i).padStart(5, '0')}`, propertyName: 'Brand New Heights' })));
    assert.ok(rs.every((r) => r.status === 201));
    assert.equal((await pool.query("SELECT count(*)::int n FROM properties WHERE name_key='brand new heights'")).rows[0].n, 1);
    assert.equal(new Set(rs.map((r) => r.body.property.id)).size, 1);
  });
});

describe('admin lead + customer queries', () => {
  it('list with filters', async () => {
    const all = (await t.call('/admin/leads?limit=200')).body;
    assert.ok(all.length >= 8);
    assert.ok(all.every((l: any) => l.customer && l.property));
    assert.ok((await t.call(`/admin/leads?propertyId=${prop2.id}&limit=200`)).body.every((l: any) => l.property.id === prop2.id));
    assert.ok((await t.call(`/admin/leads?executiveId=${amit.id}`)).body.every((l: any) => l.assignedExecutive.id === amit.id));
    assert.equal((await t.call('/admin/leads?search=ABC%20Heights&limit=200')).body.every((l: any) => l.property.name === 'ABC Heights'), true);
    assert.equal((await t.call('/admin/leads?status=PENDING_ASSIGNMENT&limit=200')).body.every((l: any) => l.status === 'PENDING_ASSIGNMENT'), true);
    assert.equal((await t.call('/admin/leads?status=CLOSED')).body.length, 0);
    assert.equal((await t.call('/admin/leads?status=BAD')).status, 400);
    assert.equal((await t.call('/admin/leads?limit=2')).body.length, 2);
  });
  it('get one / 404 / bad id', async () => {
    const id = (await t.call('/admin/leads?limit=1')).body[0].id;
    assert.equal((await t.call(`/admin/leads/${id}`)).status, 200);
    assert.equal((await t.call(`/admin/leads/${ZERO}`)).status, 404);
    assert.equal((await t.call('/admin/leads/zzz')).status, 400);
  });
  it('customers: list, search by mobile, details show every property asked about, update', async () => {
    const list = (await t.call('/admin/customers?search=98765')).body;
    assert.equal(list.length, 1);
    const c = (await t.call(`/admin/customers/${list[0].id}`)).body;
    assert.equal(c.mobile, '+919876543210');
    assert.deepEqual(c.leads.map((l: any) => l.property.name).sort().slice(0, 2), ['ABC Heights', 'XYZ Residency']);
    assert.ok(c.leads.every((l: any) => l.assignedExecutive && !('customer' in l)));
    const u = await t.call(`/admin/customers/${c.id}`, 'PATCH', { name: 'Ravi K.', email: null });
    assert.equal(u.body.name, 'Ravi K.');
    assert.equal(u.body.email, null);
    assert.equal((await t.call(`/admin/customers/${c.id}`, 'PATCH', { mobile: '9999999999' })).status, 400);
    assert.equal((await t.call(`/admin/customers/${ZERO}`)).status, 404);
  });
  it('admin can update any lead status; invalid status rejected', async () => {
    const id = (await t.call('/admin/leads?status=INCOMING&limit=1')).body[0].id;
    assert.equal((await t.call(`/admin/leads/${id}/status`, 'PATCH', { status: 'RINGING' })).body.status, 'RINGING');
    assert.equal((await t.call(`/admin/leads/${id}/status`, 'PATCH', { status: 'NOPE' })).status, 400);
  });
});

describe('executive portal', () => {
  it('executive sees only their own leads', async () => {
    const mine = await amitCall('/executive/leads?limit=200');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.length > 0);
    assert.ok(mine.body.every((l: any) => l.assignedExecutive.id === amit.id));
    const theirs = await rahulCall('/executive/leads?limit=200');
    assert.ok(theirs.body.every((l: any) => l.assignedExecutive.id === rahul.id));
    assert.equal(mine.body.some((l: any) => theirs.body.some((o: any) => o.id === l.id)), false);
  });
  it('executive cannot widen the scope via executiveId filter', async () => {
    const r = await amitCall(`/executive/leads?executiveId=${rahul.id}&limit=200`);
    assert.ok(r.body.every((l: any) => l.assignedExecutive.id === amit.id));
  });
  it("another executive's lead is 404, not 403 (existence not revealed)", async () => {
    const rahulLead = (await rahulCall('/executive/leads')).body[0];
    assert.equal((await amitCall(`/executive/leads/${rahulLead.id}`)).status, 404);
    assert.equal((await amitCall(`/executive/leads/${rahulLead.id}/status`, 'PATCH', { status: 'LOST' })).status, 404);
    assert.equal((await rahulCall(`/executive/leads/${rahulLead.id}`)).status, 200);
  });
  it('executive updates the status of their own lead', async () => {
    const lead = (await amitCall('/executive/leads')).body[0];
    for (const status of ['CONNECTED', 'CLOSED']) {
      const r = await amitCall(`/executive/leads/${lead.id}/status`, 'PATCH', { status });
      assert.equal(r.status, 200);
      assert.equal(r.body.status, status);
    }
    assert.equal((await amitCall(`/executive/leads/${lead.id}/status`, 'PATCH', { status: 'X' })).status, 400);
  });
  it('role separation: executive blocked from admin APIs, admin blocked from executive portal, anonymous 401', async () => {
    for (const path of ['/admin/leads', '/admin/customers']) {
      assert.equal((await amitCall(path)).status, 403);
      assert.equal((await t.call(path.replace('/admin', '/admin'))).status, 200);
    }
    assert.equal((await amitCall('/admin/leads', 'POST', {})).status, 403);
    assert.equal((await t.call('/executive/leads')).status, 403);
    assert.equal((await t.asToken('')('/executive/leads')).status, 401);
  });
});

describe('client history and "assigned to you" awareness', () => {
  let hitesh: any, hCall: ReturnType<typeof t.asToken>, latest: any;
  const sunita = (extra: object) =>
    t.call('/admin/leads', 'POST', { name: 'Sunita C Sinha', mobile: '9867613605', source: 'MAGICBRICKS', customerType: 'individual', ...extra });

  before(async () => {
    hitesh = await t.exec('hitesh');
    hCall = t.asToken(await t.login('executive', 'hitesh@test.com', 'TempPass123'));
    await t.property('Kalpataru Magnus', [hitesh.id]);
    await t.property('Rustomjee Oriana / Seasons', [hitesh.id]);
  });

  it('same mobile -> one client, many enquiries; each lead keeps its own requirement/budget/property', async () => {
    const a = await sunita({ propertyName: 'Kalpataru Magnus', requirement: '3 BHK on Rent', budget: 270000 });
    const b = await sunita({ mobile: '+91 98676 13605', name: 'Sunita Sinha', propertyName: 'Rustomjee Oriana / Seasons', requirement: '3 BHK on Rent', budget: 250000 });
    latest = await sunita({ propertyName: 'Rustomjee Oriana / Seasons', requirement: '3 BHK on Rent', budget: 250000 });
    assert.ok([a, b, latest].every((r) => r.status === 201));
    assert.equal(new Set([a, b, latest].map((r) => r.body.customer.id)).size, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM customers WHERE mobile='+919867613605'")).rows[0].n, 1);
    assert.equal(a.body.customer.type, 'INDIVIDUAL');
    assert.equal(latest.body.requirement, '3 BHK on Rent');
    assert.ok(latest.body.leadNo > b.body.leadNo && b.body.leadNo > a.body.leadNo, 'lead numbers increase');
    assert.equal(a.body.assignedExecutive.id, hitesh.id);
  });
  it('client type is set only when the client is first created', async () => {
    const r = await sunita({ propertyName: 'Kalpataru Magnus', customerType: 'COMPANY', mobile: '9811111111', name: 'Acme Realty' });
    assert.equal(r.body.customer.type, 'COMPANY');
    const again = await sunita({ propertyName: 'Kalpataru Magnus', customerType: 'INDIVIDUAL', mobile: '9811111111' });
    assert.equal(again.body.customer.type, 'COMPANY');
    assert.equal((await sunita({ propertyName: 'Kalpataru Magnus', customerType: 'ALIEN', mobile: '9822222222' })).status, 400);
  });
  it('opening the current lead shows the complete client history (executive and admin)', async () => {
    const asExec = await hCall(`/executive/leads/${latest.body.id}`);
    assert.equal(asExec.status, 200);
    assert.equal(asExec.body.customer.name, 'Sunita C Sinha');
    assert.equal(asExec.body.customerEnquiryCount, 3);
    const h = asExec.body.customerHistory;
    assert.deepEqual(h.map((x: any) => x.property.name), ['Rustomjee Oriana / Seasons', 'Kalpataru Magnus']);
    assert.deepEqual(h.map((x: any) => x.budget), [250000, 270000]);
    assert.ok(h.every((x: any) => x.requirement === '3 BHK on Rent' && x.assignedExecutive.name === 'Hitesh' && x.status && x.createdAt && x.leadNo));
    assert.ok(h.every((x: any) => x.id !== latest.body.id && !('customer' in x)), 'current lead is not in its own history');
    assert.deepEqual((await t.call(`/admin/leads/${latest.body.id}`)).body.customerHistory.map((x: any) => x.id), h.map((x: any) => x.id));
  });
  it('an executive sees the history but only their own lead is openable', async () => {
    const other = (await t.call('/admin/leads?search=Ravi&limit=1')).body[0];
    assert.equal((await hCall(`/executive/leads/${other.id}`)).status, 404);
  });
});

describe('executive: new-lead indicator, ordering, summary, polling filter', () => {
  let neha: any, nCall: ReturnType<typeof t.asToken>, ids: string[] = [];
  const lead = (i: number) =>
    t.call('/admin/leads', 'POST', { name: `Buyer ${i}`, mobile: `970000010${i}`, propertyName: 'Neha Towers', source: '99ACRES' });

  before(async () => {
    neha = await t.exec('neha');
    nCall = t.asToken(await t.login('executive', 'neha@test.com', 'TempPass123'));
    await t.property('Neha Towers', [neha.id]);
  });

  it('a freshly assigned lead is new, tops the list, and counts on the dashboard', async () => {
    assert.deepEqual((await nCall('/executive/leads/summary')).body, { newLeads: 0, totalLeads: 0, byStatus: {} });
    for (let i = 1; i <= 3; i++) {
      const r = await lead(i);
      assert.equal(r.body.isNew, true);
      assert.ok(r.body.assignedAt);
      ids.push(r.body.id);
    }
    const list = (await nCall('/executive/leads')).body;
    assert.deepEqual(list.map((l: any) => l.id), [ids[2], ids[1], ids[0]], 'most recently assigned first');
    assert.ok(list.every((l: any) => l.isNew));
    assert.deepEqual((await nCall('/executive/leads/summary')).body, { newLeads: 3, totalLeads: 3, byStatus: { INCOMING: 3 } });
  });
  it('opening a lead clears its New flag, and unopened leads stay above opened ones', async () => {
    const opened = await nCall(`/executive/leads/${ids[2]}`);
    assert.equal(opened.body.isNew, false);
    const list = (await nCall('/executive/leads')).body;
    assert.deepEqual(list.map((l: any) => l.id), [ids[1], ids[0], ids[2]]);
    assert.deepEqual(list.map((l: any) => l.isNew), [true, true, false]);
    assert.equal((await nCall('/executive/leads/summary')).body.newLeads, 2);
    assert.equal((await nCall('/executive/leads?isNew=true')).body.length, 2);
  });
  it('an admin looking at the lead does not clear the executive\'s New flag', async () => {
    await t.call(`/admin/leads/${ids[0]}`);
    assert.equal((await nCall('/executive/leads?isNew=true')).body.length, 2);
  });
  it('assignedSince returns only leads assigned after the given time (for polling)', async () => {
    const list = (await nCall('/executive/leads')).body;
    const mid = list.find((l: any) => l.id === ids[0]).assignedAt;
    const since = (await nCall(`/executive/leads?assignedSince=${encodeURIComponent(mid)}`)).body;
    assert.deepEqual(since.map((l: any) => l.id).sort(), [ids[1], ids[2]].sort());
    assert.equal((await nCall('/executive/leads?assignedSince=yesterday')).status, 400);
    const r = await lead(4);
    assert.deepEqual((await nCall(`/executive/leads?assignedSince=${encodeURIComponent(list[0].assignedAt)}`)).body.map((l: any) => l.id).includes(r.body.id), true);
  });
  it('pending leads assigned later become new for that executive', async () => {
    const pend = await t.call('/admin/leads', 'POST', { name: 'Late', mobile: '9700000200', propertyName: 'Late Towers', source: '99ACRES' });
    assert.equal(pend.body.isNew, false, 'nobody to be notified yet');
    const p = (await t.call('/admin/properties?search=Late')).body[0];
    await t.call(`/admin/properties/${p.id}/executives`, 'PUT', { executiveIds: [neha.id] });
    const mine = (await nCall('/executive/leads?isNew=true')).body;
    assert.ok(mine.some((l: any) => l.id === pend.body.id));
  });
  it('the summary is per executive', async () => {
    assert.equal((await amitCall('/executive/leads/summary')).status, 200);
    assert.equal((await t.call('/executive/leads/summary')).status, 403);
  });
});

describe('integrity', () => {
  it('leads/customers/properties with history cannot be hard-deleted', async () => {
    await assert.rejects(pool.query('DELETE FROM properties WHERE id=$1', [prop.id]), /foreign key constraint/);
    const cid = (await pool.query('SELECT customer_id FROM leads LIMIT 1')).rows[0].customer_id;
    await assert.rejects(pool.query('DELETE FROM customers WHERE id=$1', [cid]), /foreign key constraint/);
    const lid = (await pool.query('SELECT lead_id FROM property_assignment_history LIMIT 1')).rows[0].lead_id;
    await assert.rejects(pool.query('DELETE FROM leads WHERE id=$1', [lid]), /property_assignment_history_lead_id_fkey/);
  });
  it('history rejects a lead id that does not exist', async () => {
    await assert.rejects(
      pool.query(`INSERT INTO property_assignment_history (property_id, executive_id, lead_id)
                  VALUES ($1,$2,gen_random_uuid())`, [prop.id, amit.id]),
      /property_assignment_history_lead_id_fkey/);
  });
  void priya;
});
