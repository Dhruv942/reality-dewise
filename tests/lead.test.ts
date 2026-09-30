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
  t.call('/admin/leads', 'POST', { name: 'Ravi Kumar', mobile: '9876543210', email: 'Ravi@Mail.com', propertyId: prop.id, message: 'Interested in 2 BHK', ...extra });

before(async () => {
  t = await startTestApp();
  team = await t.team('Team A');
  amit = await t.exec('amit', team.id);
  rahul = await t.exec('rahul', team.id);
  priya = await t.exec('priya', team.id);
  prop = await t.property({ externalPropertyId: 'MB12345', source: '99ACRES', name: 'XYZ Residency', location: 'Ahmedabad', teamId: team.id, primaryExecutiveId: amit.id });
  prop2 = await t.property({ externalPropertyId: 'MB999', source: 'MAGICBRICKS', name: 'ABC Heights', teamId: team.id });
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
  it('creates customer + lead, shows the property asked about, assigns the primary executive', async () => {
    const r = await enquire();
    assert.equal(r.status, 201);
    first = r.body;
    assert.equal(first.status, 'NEW');
    assert.equal(first.customer.name, 'Ravi Kumar');
    assert.equal(first.customer.mobile, '+919876543210');
    assert.equal(first.customer.email, 'ravi@mail.com');
    assert.equal(first.property.name, 'XYZ Residency');
    assert.equal(first.property.externalPropertyId, 'MB12345');
    assert.equal(first.source, '99ACRES');
    assert.equal(first.message, 'Interested in 2 BHK');
    assert.equal(first.assignedExecutive.id, amit.id);
    assert.deepEqual(first.assignment, { type: 'PRIMARY', reason: 'PRIMARY_EXECUTIVE_AVAILABLE' });
    assert.ok(first.createdAt);
  });
  it('assignment history references the real lead', async () => {
    const h = await t.call(`/admin/properties/${prop.id}/assignment-history`);
    assert.equal(h.body.history[0].leadId, first.id);
  });
  it('same customer enquiring again reuses the customer but creates a new lead', async () => {
    const r = await enquire({ mobile: '+91 98765 43210', name: 'Someone Else', propertyId: prop2.id });
    assert.equal(r.status, 201);
    assert.equal(r.body.customer.id, first.customer.id);
    assert.equal(r.body.customer.name, 'Ravi Kumar', 'existing customer name is kept');
    assert.equal(r.body.property.name, 'ABC Heights');
    assert.equal(r.body.assignment.reason, 'NO_PRIMARY_EXECUTIVE');
    assert.equal((await pool.query('SELECT count(*)::int n FROM customers')).rows[0].n, 1);
  });
  it('primary unavailable -> fallback round robin; primary back -> primary again', async () => {
    await t.setActive(amit.id, false);
    const a = await enquire({ mobile: '9000000001' });
    const b = await enquire({ mobile: '9000000002' });
    assert.equal(a.body.assignment.reason, 'PRIMARY_EXECUTIVE_UNAVAILABLE');
    assert.equal(a.body.assignedExecutive.id === b.body.assignedExecutive.id, false);
    assert.ok(![a, b].some((x) => x.body.assignedExecutive.id === amit.id));
    await t.setActive(amit.id, true);
    assert.equal((await enquire({ mobile: '9000000003' })).body.assignedExecutive.id, amit.id);
  });
  it('validation: mobile, name, email, property, extra fields', async () => {
    for (const bad of [{ mobile: '123' }, { mobile: undefined }, { name: '' }, { email: 'nope' }, { propertyId: 'x' }, { role: 'ADMIN' }]) {
      const r = await enquire(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal((await enquire({ propertyId: ZERO })).status, 400);
  });
  it('inactive property or property without a team is rejected and NOTHING is stored', async () => {
    const before = (await pool.query('SELECT (SELECT count(*) FROM customers)::int c, (SELECT count(*) FROM leads)::int l')).rows[0];
    const off = await t.property({ externalPropertyId: 'OFF', source: '99ACRES', name: 'Off', teamId: team.id, isActive: false });
    const noTeam = await t.property({ externalPropertyId: 'NT', source: '99ACRES', name: 'No team' });
    assert.equal((await enquire({ mobile: '9111111111', propertyId: off.id })).status, 409);
    assert.equal((await enquire({ mobile: '9222222222', propertyId: noTeam.id })).status, 409);
    const after = (await pool.query('SELECT (SELECT count(*) FROM customers)::int c, (SELECT count(*) FROM leads)::int l')).rows[0];
    assert.deepEqual(after, before, 'rolled back: no orphan customer or lead');
  });
});

describe('external lead id (idempotent retries)', () => {
  it('same (source, externalLeadId) returns the existing lead and does not rotate or duplicate', async () => {
    const a = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyId: prop2.id });
    const b = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyId: prop2.id });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.id, a.body.id);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leads WHERE external_lead_id='EXT-1'`)).rows[0].n, 1);
  });
  it('parallel duplicates create exactly one lead', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => enquire({ mobile: '9444444444', externalLeadId: 'EXT-2', propertyId: prop2.id })));
    assert.equal(new Set(rs.map((r) => r.body.id)).size, 1);
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM leads WHERE external_lead_id='EXT-2'`)).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM property_assignment_history WHERE lead_id=$1`, [rs[0].body.id])).rows[0].n, 1);
  });
  it('the same external id from another source is a different lead', async () => {
    const r = await enquire({ mobile: '9333333333', externalLeadId: 'EXT-1', propertyId: prop.id }); // 99ACRES, EXT-1 was MAGICBRICKS
    assert.equal(r.status, 201);
  });
});

describe('parallel enquiries', () => {
  it('30 simultaneous enquiries on a fallback property spread evenly across the team', async () => {
    const c = await t.team('Conc');
    const es = [await t.exec('cc.a', c.id), await t.exec('cc.b', c.id), await t.exec('cc.c', c.id)];
    const p = await t.property({ externalPropertyId: 'CONC', source: '99ACRES', name: 'Conc', teamId: c.id });
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => enquire({ mobile: `98000${String(i).padStart(5, '0')}`, propertyId: p.id })));
    assert.ok(rs.every((r) => r.status === 201));
    for (const e of es) assert.equal(rs.filter((r) => r.body.assignedExecutive.id === e.id).length, 10);
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
    assert.equal((await t.call('/admin/leads?status=WON')).body.length, 0);
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
    const id = (await t.call('/admin/leads?limit=1')).body[0].id;
    assert.equal((await t.call(`/admin/leads/${id}/status`, 'PATCH', { status: 'CONTACTED' })).body.status, 'CONTACTED');
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
    for (const status of ['SITE_VISIT', 'WON']) {
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
      pool.query(`INSERT INTO property_assignment_history (property_id, team_id, executive_id, assignment_type, reason, lead_id)
                  VALUES ($1,$2,$3,'PRIMARY','PRIMARY_EXECUTIVE_AVAILABLE',gen_random_uuid())`, [prop.id, team.id, amit.id]),
      /property_assignment_history_lead_id_fkey/);
  });
  void priya;
});
