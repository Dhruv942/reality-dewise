import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('portal property mappings', () => {
  it('registers one portal listing, exposes it from the property, and rejects conflicts', async () => {
    const a = await t.property('Rustomjee Elita');
    const b = await t.property('Lodha Altamount');
    const created = await t.call('/admin/property-mappings', 'POST', {
      propertyId: a.id,
      portalSource: '99ACRES',
      externalPropertyId: '99-12345',
      externalPropertyName: 'Rustomjee-Elita Phase 1',
      externalListingUrl: 'https://99acres.example/99-12345',
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.propertyId, a.id);
    assert.equal(created.body.normalizedPropertyName, 'rustomjee elita phase 1');
    assert.equal((await t.call(`/admin/properties/${a.id}/mappings`)).body.length, 1);
    assert.equal((await t.call('/admin/property-mappings?portalSource=99ACRES&externalPropertyId=99-12345')).body.length, 1);
    assert.equal((await t.call('/admin/property-mappings', 'POST', { propertyId: b.id, portalSource: '99ACRES', externalPropertyId: '99-12345', externalPropertyName: 'Other' })).status, 409);
    assert.equal((await t.call('/admin/property-mappings', 'POST', { propertyId: b.id, portalSource: '99ACRES', externalPropertyName: 'Rustomjee-Elita Phase 1' })).status, 409);
  });

  it('deactivates a mapping and enforces Admin-only access', async () => {
    const p = await t.property('Mapping Access');
    const m = (await t.call('/admin/property-mappings', 'POST', { propertyId: p.id, portalSource: 'MAGICBRICKS', externalPropertyName: 'Mapping Access' })).body;
    assert.equal((await t.call(`/admin/property-mappings/${m.id}`, 'DELETE')).body.isActive, false);
    const exec = await t.exec('mapping.exec');
    const token = await t.login('executive', 'mapping.exec@test.com', 'TempPass123');
    assert.equal((await t.asToken(token)('/admin/property-mappings')).status, 403);
    assert.ok(exec.id);
  });
});
