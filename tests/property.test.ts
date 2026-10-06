import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let team: any, amit: any, rahul: any;

before(async () => {
  t = await startTestApp();
  team = await t.team('Team A');
  amit = await t.exec('amit', team.id);
  rahul = await t.exec('rahul', team.id);
});
after(() => t.close());

const lead = (extra: object = {}) =>
  t.call('/admin/leads', 'POST', { name: 'Ravi', mobile: '9876543210', propertyName: 'Green Valley Residency', source: '99ACRES', ...extra });

describe('properties are created by leads, not by hand', () => {
  it('there is no create endpoint', async () => {
    assert.equal((await t.call('/admin/properties', 'POST', { name: 'X' })).status, 404);
  });
  it('a lead for an unknown name creates one stub property flagged as needing executives', async () => {
    assert.equal((await t.call('/admin/properties')).body.length, 0);
    assert.equal((await lead()).status, 201);
    const list = (await t.call('/admin/properties')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'Green Valley Residency');
    assert.equal(list[0].isStub, true);
    assert.equal(list[0].needsAssignment, true);
    assert.equal(list[0].assignedExecutiveCount, 0);
    assert.equal(list[0].pendingLeadCount, 1);
  });
  it('more leads (any casing/spacing, either portal) reuse the same property: never a duplicate', async () => {
    await lead({ mobile: '9000000001', propertyName: '  green   VALLEY residency ', source: 'MAGICBRICKS' });
    await Promise.all(Array.from({ length: 8 }, (_, i) => lead({ mobile: `91000000${10 + i}`, propertyName: 'GREEN VALLEY RESIDENCY' })));
    const list = (await t.call('/admin/properties')).body;
    assert.equal(list.length, 1);
    assert.equal(list[0].pendingLeadCount, 10);
  });
});

describe('property CRUD', () => {
  let p: any;
  before(async () => { p = (await t.call('/admin/properties')).body[0]; });

  it('get single includes its executives', async () => {
    const r = await t.call(`/admin/properties/${p.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.executives, []);
    assert.equal((await t.call(`/admin/properties/${ZERO}`)).status, 404);
    assert.equal((await t.call('/admin/properties/zzz')).status, 400);
  });
  it('update details; unknown fields rejected; renaming onto another property is 409', async () => {
    const other = await t.property('Blue Hills');
    const r = await t.call(`/admin/properties/${p.id}`, 'PATCH', { location: 'Surat', description: 'Gated' });
    assert.equal(r.body.location, 'Surat');
    assert.equal((await t.call(`/admin/properties/${p.id}`, 'PATCH', { name: 'blue  HILLS' })).status, 409);
    assert.equal((await t.call(`/admin/properties/${other.id}`, 'PATCH', { name: 'Blue Hills Phase 2' })).body.name, 'Blue Hills Phase 2');
    assert.equal((await t.call(`/admin/properties/${p.id}`, 'PATCH', { source: '99ACRES' })).status, 400);
    assert.equal((await t.call(`/admin/properties/${p.id}`, 'PATCH', {})).status, 400);
  });
  it('list filters: assigned, isActive, search', async () => {
    assert.equal((await t.call('/admin/properties?assigned=false')).body.length, 2);
    assert.equal((await t.call('/admin/properties?assigned=true')).body.length, 0);
    assert.equal((await t.call('/admin/properties?search=green')).body.length, 1);
    assert.equal((await t.call('/admin/properties?isActive=false')).body.length, 0);
    assert.equal((await t.call('/admin/properties?assigned=maybe')).status, 400);
  });
  it('deactivate / reactivate', async () => {
    const off = await t.call(`/admin/properties/${p.id}/status`, 'PATCH', { isActive: false });
    assert.equal(off.body.isActive, false);
    assert.equal((await lead({ mobile: '9222222222' })).status, 409, 'inactive property takes no leads');
    assert.equal((await t.call(`/admin/properties/${p.id}/status`, 'PATCH', { isActive: true })).body.isActive, true);
    assert.equal((await t.call(`/admin/properties/${p.id}/status`, 'PATCH', { isActive: 'yes' })).status, 400);
  });
});

describe('hand-picked executives', () => {
  let p: any;
  before(async () => { p = (await t.call('/admin/properties?search=green')).body[0]; });
  const put = (body: unknown, id = p.id) => t.call(`/admin/properties/${id}/executives`, 'PUT', body);

  it('validation: unknown / inactive / admin user / bad ids / extra fields / property unknown', async () => {
    const off = await t.exec('off.exec', team.id);
    await t.setActive(off.id, false);
    assert.equal((await put({ executiveIds: [ZERO] })).status, 400);
    assert.equal((await put({ executiveIds: [off.id] })).status, 409);
    const adminId = (await (await import('../src/database/pool')).pool.query("SELECT id FROM users WHERE role='ADMIN' LIMIT 1")).rows[0].id;
    assert.equal((await put({ executiveIds: [adminId] })).status, 400);
    assert.equal((await put({ executiveIds: ['x'] })).status, 400);
    assert.equal((await put({ executiveIds: 'x' })).status, 400);
    assert.equal((await put({ executiveIds: [], team: 'x' })).status, 400);
    assert.equal((await put({ executiveIds: [amit.id] }, ZERO)).status, 404);
  });
  it('setting executives assigns the waiting PENDING_ASSIGNMENT leads round-robin, oldest first', async () => {
    const r = await put({ executiveIds: [amit.id, rahul.id, amit.id] }); // duplicate id is ignored
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.executives.map((e: any) => e.id), [amit.id, rahul.id]);
    assert.equal(r.body.assignedPendingLeads, 10);
    assert.equal(r.body.needsAssignment, false);
    assert.equal(r.body.pendingLeadCount, 0);
    const leads = (await t.call(`/admin/leads?propertyId=${p.id}&limit=200`)).body;
    assert.ok(leads.every((l: any) => l.status === 'INCOMING' && l.assignedExecutive));
    assert.equal(leads.filter((l: any) => l.assignedExecutive.id === amit.id).length, 5);
    const oldest = [...leads].reverse();
    assert.equal(oldest[0].assignedExecutive.id, amit.id);
    assert.equal(oldest[1].assignedExecutive.id, rahul.id);
  });
  it('replace semantics: the list is exactly what was sent; [] un-assigns', async () => {
    assert.deepEqual((await put({ executiveIds: [rahul.id] })).body.executives.map((e: any) => e.id), [rahul.id]);
    const cleared = await put({ executiveIds: [] });
    assert.equal(cleared.body.needsAssignment, true);
    assert.equal(cleared.body.assignedPendingLeads, 0);
  });
});
