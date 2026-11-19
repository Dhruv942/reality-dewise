import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('reports and analytics', () => {
  it('creates manual leads with an optional manual sub-source and reports them as MANUAL', async () => {
    const lead = await t.call('/admin/leads', 'POST', {
      name: 'Walk-in Buyer',
      mobile: '9876510091',
      propertyName: 'Manual Lead Property',
      source: 'MANUAL',
      manualSubSource: 'WALK_IN',
    });
    assert.equal(lead.status, 201);
    assert.equal(lead.body.source, 'MANUAL');
    assert.equal(lead.body.manualSubSource, 'WALK_IN');

    const report = await t.call('/admin/reports/overview?source=MANUAL');
    assert.equal(report.status, 200);
    assert.equal(report.body.data.summary.total, 1);
    assert.equal(report.body.data.breakdowns.bySource[0].label, 'MANUAL');
  });

  it('rejects a manual sub-source on portal leads', async () => {
    const response = await t.call('/admin/leads', 'POST', {
      name: 'Portal Buyer',
      mobile: '9876510092',
      propertyName: 'Portal Lead Property',
      source: '99ACRES',
      manualSubSource: 'WALK_IN',
    });
    assert.equal(response.status, 400);
  });

  it('includes an eligible property even when it has no leads', async () => {
    const property = await t.property('No Lead Report Property');
    const report = await t.call(`/admin/reports/properties?propertyId=${property.id}`);
    assert.equal(report.status, 200);
    assert.deepEqual(report.body.data.rows, [{
      propertyId: property.id,
      propertyName: property.name,
      projectId: null,
      projectName: null,
      leads: 0,
      inventoryCount: 0,
      availableInventoryCount: 0,
    }]);
  });

  it('transactions report groups by property transaction type, independently of source', async () => {
    const rent = await t.property('Transaction Rent Property');
    const sale = await t.property('Transaction Sale Property');
    await t.call(`/admin/properties/${rent.id}`, 'PATCH', { transactionType: 'RENT_LEASE' });
    await t.call(`/admin/properties/${sale.id}`, 'PATCH', { transactionType: 'SALE_PURCHASE' });
    const rentLead = await t.call('/admin/leads', 'POST', { name: 'Rent Transaction Lead', mobile: '9876510011', propertyName: rent.name, source: '99ACRES' });
    const saleLead = await t.call('/admin/leads', 'POST', { name: 'Sale Transaction Lead', mobile: '9876510012', propertyName: sale.name, source: '99ACRES' });
    assert.equal(rentLead.status, 201);
    assert.equal(saleLead.status, 201);

    const report = await t.call('/admin/reports/transactions?source=99ACRES');
    assert.equal(report.status, 200);
    assert.deepEqual(report.body.data.byTransactionType.map((x: any) => [x.label, x.count]).sort(), [
      ['RENT_LEASE', 1],
      ['SALE_PURCHASE', 1],
    ]);
  });

  it('price-band reporting uses each lead budget rather than the parent property price', async () => {
    const property = await t.property('Budget Report Property');
    await t.call(`/admin/properties/${property.id}`, 'PATCH', { minPrice: 30_000_000, maxPrice: 30_000_000 });
    const thousands = await t.call('/admin/leads', 'POST', { name: 'Budget Thousands Lead', mobile: '9876510013', propertyName: property.name, source: '99ACRES', budget: 50_000 });
    const aboveTwo = await t.call('/admin/leads', 'POST', { name: 'Budget Crores Lead', mobile: '9876510014', propertyName: property.name, source: '99ACRES', budget: 30_000_000 });
    assert.equal(thousands.status, 201);
    assert.equal(aboveTwo.status, 201);

    const report = await t.call(`/admin/reports/overview?propertyId=${property.id}`);
    assert.equal(report.status, 200);
    assert.deepEqual(report.body.data.breakdowns.byPriceBand.map((x: any) => [x.label, x.count]).sort(), [
      ['ABOVE_2_TO_4_CR', 1],
      ['THOUSANDS', 1],
    ]);
  });

  it('aggregates current leads by status, source, property dimensions and price band', async () => {
    const executive = await t.exec('report-exec');
    const property = await t.property('Report Heights', [executive.id]);
    const project = (await t.call('/admin/projects', 'POST', { name: 'Report Project', location: 'Andheri West' })).body;
    await t.call(`/admin/properties/${property.id}`, 'PATCH', {
      projectId: project.id, transactionType: 'SALE_PURCHASE', propertyType: 'RESIDENTIAL', location: 'Andheri West', minPrice: 25_000_000, maxPrice: 25_000_000,
    });
    const created = await t.call('/admin/leads', 'POST', { name: 'Report Buyer', mobile: '9876510001', propertyName: property.name, source: '99ACRES', budget: 25_000_000 });
    assert.equal(created.status, 201);
    const pending = await t.call('/admin/leads', 'POST', { name: 'Pending Buyer', mobile: '9876510002', propertyName: 'Unlisted Report Property', source: 'MAGICBRICKS' });
    assert.equal(pending.status, 201);

    const report = await t.call(`/admin/reports/overview?propertyId=${property.id}`);
    assert.equal(report.status, 200);
    assert.equal(report.body.data.summary.total, 1);
    assert.equal(report.body.data.summary.assigned, 1);
    assert.equal(report.body.data.summary.unassigned, 0);
    assert.equal(report.body.data.breakdowns.bySource.find((x: { label: string }) => x.label === '99ACRES').count, 1);
    assert.equal(report.body.data.breakdowns.byPriceBand.find((x: { label: string }) => x.label === 'ABOVE_2_TO_4_CR').count, 1);
    assert.equal(report.body.data.breakdowns.byLocation.find((x: { label: string }) => x.label === 'Andheri West').count, 1);
  });

  it('applies combined filters and returns only non-sensitive lead report rows', async () => {
    const property = await t.property('Filtered Report Property');
    const created = await t.call('/admin/leads', 'POST', { name: 'Filtered Buyer', mobile: '9876510003', propertyName: property.name, source: 'MAGICBRICKS', enquiryType: 'RENT' });
    assert.equal(created.status, 201);
    const response = await t.call('/admin/reports/leads?source=MAGICBRICKS&transactionType=RENT_LEASE&propertyId=' + property.id);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.rows.length, 0, 'lead enquiryType does not replace property transaction type');
    const all = await t.call('/admin/reports/leads?source=MAGICBRICKS&propertyId=' + property.id);
    assert.equal(all.body.data.rows.length, 1);
    assert.equal('customerMobile' in all.body.data.rows[0], false);
  });

  it('enforces manager scope even when the query asks for another executive', async () => {
    const managerA = await t.manager('report-manager-a');
    const managerB = await t.manager('report-manager-b');
    const execA = await t.exec('report-exec-a', managerA.id);
    const execB = await t.exec('report-exec-b', managerB.id);
    const propertyA = await t.property('Manager Report A', [execA.id]);
    const propertyB = await t.property('Manager Report B', [execB.id]);
    const aLead = await t.call('/admin/leads', 'POST', { name: 'A Buyer', mobile: '9876510004', propertyName: propertyA.name, source: '99ACRES' });
    const bLead = await t.call('/admin/leads', 'POST', { name: 'B Buyer', mobile: '9876510005', propertyName: propertyB.name, source: '99ACRES' });
    const token = await t.login('manager', 'report-manager-a@test.com', 'TempPass123');
    const response = await t.asToken(token)(`/manager/reports/leads?executiveId=${execB.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.rows.length, 0);
    const own = await t.asToken(token)('/manager/reports/leads');
    assert.ok(own.body.data.rows.some((item: { leadId: string }) => item.leadId === aLead.body.id));
    assert.equal(own.body.data.rows.some((item: { leadId: string }) => item.leadId === bLead.body.id), false);
    const ownProperty = await t.asToken(token)(`/manager/reports/properties?propertyId=${propertyA.id}`);
    assert.equal(ownProperty.body.data.rows.length, 1);
    const otherProperty = await t.asToken(token)(`/manager/reports/properties?propertyId=${propertyB.id}`);
    assert.equal(otherProperty.body.data.rows.length, 0);
  });

  it('exposes follow-up limitations instead of fabricating completed counts', async () => {
    const report = await t.call('/admin/reports/follow-ups');
    assert.equal(report.status, 200);
    assert.equal(report.body.data.summary.completed, null);
    assert.equal(report.body.data.summary.completedAvailable, false);
  });

  it('supports safe CSV export through the same filtered lead query', async () => {
    const lead = await t.call('/admin/leads', 'POST', { name: 'Formula Buyer', mobile: '9876510006', propertyName: '=SUM(1+1)', source: '99ACRES' });
    assert.equal(lead.status, 201);
    const rows = await pool.query<{ name: string }>('SELECT name FROM properties WHERE name = $1', ['=SUM(1+1)']);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].name, '=SUM(1+1)');
    const token = await t.login('admin', 'admin@test.com', 'Admin-pass-123');
    const csvResponse = await fetch(`${t.base}/api/v1/admin/reports/leads?propertyId=${lead.body.property.id}&format=csv`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(csvResponse.status, 200);
    assert.match(csvResponse.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(await csvResponse.text(), /'=SUM\(1\+1\)/);
    const excelResponse = await fetch(`${t.base}/api/v1/admin/reports/leads?propertyId=${lead.body.property.id}&format=excel`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(excelResponse.status, 200);
    assert.match(excelResponse.headers.get('content-type') ?? '', /application\/vnd\.ms-excel/);
  });
});
