import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('portal property matching and unresolved routing', () => {
  it('uses an exact portal id before the incoming listing name and preserves round-robin assignment', async () => {
    const executive = await t.exec('match-exec');
    const property = await t.property('Rustomjee Elita', [executive.id]);
    await t.call('/admin/property-mappings', 'POST', {
      propertyId: property.id,
      portalSource: '99ACRES',
      externalPropertyId: '99-EXACT-1',
      externalPropertyName: 'Rustomjee Elita Phase 1',
    });
    const result = await t.call('/admin/leads', 'POST', {
      name: 'Exact Buyer', mobile: '9876500001', propertyName: 'Completely Different Portal Name',
      source: '99ACRES', externalPropertyId: '99-EXACT-1', externalPropertyName: 'Completely Different Portal Name',
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.property.id, property.id);
    assert.equal(result.body.propertyMatch.method, 'EXTERNAL_ID');
    assert.equal(result.body.assignedExecutive.id, executive.id);
  });

  it('keeps an unknown listing visible for review and reuses its placeholder mapping', async () => {
    const first = await t.call('/admin/leads', 'POST', {
      name: 'Unknown One', mobile: '9876500002', propertyName: 'Portal New Tower', source: 'MAGICBRICKS',
      externalPropertyId: 'MB-UNKNOWN-1', externalPropertyName: 'Portal New Tower',
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.status, 'PENDING_ASSIGNMENT');
    assert.equal(first.body.propertyMatch.status, 'UNMATCHED');
    assert.equal((await t.call('/admin/leads/unmatched-properties')).body.length, 1);

    const second = await t.call('/admin/leads', 'POST', {
      name: 'Unknown Two', mobile: '9876500003', propertyName: 'Different Portal Spelling', source: 'MAGICBRICKS',
      externalPropertyId: 'MB-UNKNOWN-1', externalPropertyName: 'Different Portal Spelling',
    });
    assert.equal(second.status, 201);
    assert.equal(second.body.property.id, first.body.property.id);
  });

  it('resolves an unresolved lead, registers a mapping, and assigns through the existing pool', async () => {
    const executive = await t.exec('resolve-exec');
    const property = await t.property('Verified Resolution Property', [executive.id]);
    const unresolved = await t.call('/admin/leads', 'POST', {
      name: 'Needs Review', mobile: '9876500004', propertyName: 'Unresolved Portal Listing', source: '99ACRES',
      externalPropertyId: '99-RESOLVE-1', externalPropertyName: 'Unresolved Portal Listing',
    });
    assert.equal(unresolved.status, 201, JSON.stringify(unresolved.body));
    const leadId = unresolved.body.id as string;
    const candidates = await t.call(`/admin/leads/${leadId}/property-match-candidates`);
    assert.equal(candidates.status, 200);
    const resolved = await t.call(`/admin/leads/${leadId}/register-property-mapping`, 'POST', { propertyId: property.id });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.property.id, property.id);
    assert.equal(resolved.body.assignedExecutive.id, executive.id);
    assert.equal(resolved.body.propertyMatch.status, 'RESOLVED');
    assert.ok(resolved.body.activity.some((a: { type: string }) => a.type === 'PROPERTY_RESOLVED'));
    const mappings = await t.call(`/admin/properties/${property.id}/mappings`);
    assert.equal(mappings.body[0].externalPropertyId, '99-RESOLVE-1');
  });

  it('routes unresolved leads to an Admin-configured active manager', async () => {
    const manager = await t.manager('review-manager');
    const setting = await t.call('/admin/settings/unmatched-property-routing', 'PUT', { mode: 'DESIGNATED_MANAGER', managerId: manager.id });
    assert.equal(setting.status, 200);
    assert.equal(setting.body.mode, 'DESIGNATED_MANAGER');
    const lead = await t.call('/admin/leads', 'POST', {
      name: 'Manager Review', mobile: '9876500005', propertyName: 'Manager Review Listing', source: 'MAGICBRICKS',
      externalPropertyId: 'MB-MANAGER-REVIEW-1', externalPropertyName: 'Manager Review Listing',
    });
    assert.equal(lead.status, 201, JSON.stringify(lead.body));
    assert.equal(lead.body.propertyMatch.reviewManagerId, manager.id);
    const managerToken = await t.login('manager', 'review-manager@test.com', 'TempPass123');
    const managerLeads = await t.asToken(managerToken)('/manager/leads?propertyMatchStatus=UNMATCHED');
    assert.ok(managerLeads.body.some((item: { id: string }) => item.id === lead.body.id));
  });
});
