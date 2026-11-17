import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('inventory', () => {
  let property: any;
  let project: any;
  before(async () => {
    project = (await t.call('/admin/projects', 'POST', { name: 'Elita Project' })).body;
    property = await t.property('Elita Tower');
    const updated = await t.call(`/admin/properties/${property.id}`, 'PATCH', {
      projectId: project.id,
      transactionType: 'SALE_PURCHASE',
      propertyType: 'RESIDENTIAL',
      minPrice: 1_50_00_000,
      maxPrice: 1_50_00_000,
    });
    assert.equal(updated.status, 200);
    assert.equal((await t.call(`/admin/projects/${project.id}`)).body.properties[0].id, property.id);
  });

  it('creates inventory with a server-generated ten-digit code and inherited defaults', async () => {
    const r = await t.call('/admin/inventory', 'POST', { propertyId: property.id, name: 'Flat 1204', minPrice: 1_50_00_000, maxPrice: 1_50_00_000 });
    assert.equal(r.status, 201);
    assert.match(r.body.inventoryCode, /^\d{10}$/);
    assert.equal(r.body.property.id, property.id);
    assert.equal(r.body.transactionType, 'SALE_PURCHASE');
    assert.equal(r.body.propertyType, 'RESIDENTIAL');
    assert.equal(r.body.priceBand, 'UP_TO_2_CR');
    assert.equal(r.body.status, 'AVAILABLE');
  });

  it('generates unique codes under concurrent creation and supports filters', async () => {
    const created = await Promise.all(Array.from({ length: 8 }, (_, i) => t.call('/admin/inventory', 'POST', { propertyId: property.id, name: `Flat ${i + 1}`, minPrice: 50_000 })));
    assert.ok(created.every((r) => r.status === 201));
    assert.equal(new Set(created.map((r) => r.body.inventoryCode)).size, 8);
    const list = await t.call('/admin/inventory?propertyId=' + property.id + '&priceBand=THOUSANDS&limit=100');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 8);
  });

  it('validates lifecycle, archived parents and admin-only access', async () => {
    const created = (await t.call('/admin/inventory', 'POST', { propertyId: property.id, name: 'Flat 1301' })).body;
    assert.equal((await t.call(`/admin/inventory/${created.id}/status`, 'POST', { status: 'RESERVED' })).status, 200);
    assert.equal((await t.call(`/admin/inventory/${created.id}/status`, 'POST', { status: 'AVAILABLE' })).status, 200);
    assert.equal((await t.call(`/admin/inventory/${created.id}/status`, 'POST', { status: 'SOLD' })).status, 200);
    assert.equal((await t.call(`/admin/inventory/${created.id}/status`, 'POST', { status: 'AVAILABLE' })).status, 409);

    await t.call(`/admin/properties/${property.id}/archive`, 'POST');
    assert.equal((await t.call('/admin/inventory', 'POST', { propertyId: property.id, name: 'Rejected' })).status, 409);
    const exec = await t.exec('inventory.exec');
    const token = await t.login('executive', 'inventory.exec@test.com', 'TempPass123');
    assert.equal((await t.asToken(token)('/admin/inventory')).status, 403);
    assert.ok(exec.id);
  });
});
