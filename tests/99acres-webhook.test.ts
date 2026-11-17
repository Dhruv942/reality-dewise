import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { map99acresPayload } from '../src/modules/webhooks/99acres.mapper';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let property: { id: string; name: string };

const payload = (extra: object = {}) => ({
  leadId: '99-TEST-1',
  name: '99 Buyer',
  mobile: '+91 98765 43210',
  email: 'BUYER@EXAMPLE.COM',
  propertyName: property.name,
  propertyId: '99-PROPERTY-1',
  enquiryType: 'rent',
  message: 'Interested in a 2 BHK',
  createdAt: '2026-11-13T10:15:00+05:30',
  ignoredField: 'must not become a lead field',
  ...extra,
});

const webhook = async (body: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`${t.base}/api/v1/webhooks/99acres/leads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as any };
};

before(async () => {
  t = await startTestApp();
  const executive = await t.exec('99acres-exec');
  property = await t.property('99acres Heights', [executive.id]);
});

after(() => t.close());

describe('99acres payload mapper', () => {
  it('maps supported fields, normalizes mobile, and ignores unsupported fields', () => {
    const mapped = map99acresPayload(payload());
    assert.deepEqual(mapped, {
      name: '99 Buyer',
      mobile: '+919876543210',
      email: 'buyer@example.com',
      propertyName: property.name,
      externalPropertyId: '99-PROPERTY-1',
      externalPropertyName: property.name,
      externalPropertyUrl: undefined,
      source: '99ACRES',
      enquiryType: 'RENT',
      message: 'Interested in a 2 BHK',
      externalLeadId: '99-TEST-1',
      externalCreatedAt: new Date('2026-11-13T04:45:00.000Z'),
      rawPayload: payload(),
    });
    assert.equal('ignoredField' in mapped, false);
  });

  it('accepts aliases and creates a timestamped fallback id', () => {
    const mapped = map99acresPayload({
      customerName: 'Alias Buyer',
      phone: '9876543211',
      projectName: 'Alias Heights',
      enquiry: 'sale',
      comments: 'Call me',
      leadCreatedAt: '2026-11-13T05:00:00Z',
    });
    assert.equal(mapped.name, 'Alias Buyer');
    assert.equal(mapped.mobile, '+919876543211');
    assert.equal(mapped.propertyName, 'Alias Heights');
    assert.equal(mapped.enquiryType, 'BUY');
    assert.match(mapped.externalLeadId ?? '', /^ac-fallback:[a-f0-9]{64}$/);
  });

  it('accepts 99acres sale type codes', () => {
    const expected = { S: 'BUY', R: 'RENT', P: 'RENT', L: 'RENT' } as const;
    for (const [code, canonical] of Object.entries(expected)) {
      const mapped = map99acresPayload(payload({ leadId: `99-CODE-${code}`, enquiryType: code }));
      assert.equal(mapped.enquiryType, canonical, `${code} should map to ${canonical}`);
    }
  });

  it('rejects missing required fields and invalid values', () => {
    assert.throws(() => map99acresPayload({ name: 'Missing mobile', propertyName: 'Nope' }), /Validation failed/);
    assert.throws(() => map99acresPayload({ name: 'Bad mobile', mobile: '123', propertyName: 'Nope' }), /Validation failed/);
    assert.throws(() => map99acresPayload({ name: 'Bad type', mobile: '9876543212', propertyName: 'Nope', enquiryType: 'exchange' }), /Validation failed/);
  });
});

describe('POST /api/v1/webhooks/99acres/leads', () => {
  it('creates a lead without authentication and uses the existing assignment workflow', async () => {
    const response = await webhook(payload());
    assert.equal(response.status, 201);
    assert.equal(response.body.lead.source, '99ACRES');
    assert.equal(response.body.lead.externalLeadId, '99-TEST-1');
    assert.equal(response.body.lead.customer.mobile, '+919876543210');
    assert.equal(response.body.lead.assignedExecutive.name, '99acres-exec');
  });

  it('returns the existing lead for repeated delivery without creating another lead', async () => {
    const first = await webhook(payload({ leadId: '99-RETRY-1' }));
    const second = await webhook(payload({ leadId: '99-RETRY-1', message: 'Changed by retry' }));
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.lead.id, first.body.lead.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM leads WHERE source = '99ACRES' AND external_lead_id = '99-RETRY-1'")).rows[0].n, 1);
  });

  it('concurrent delivery of one external id creates exactly one lead', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => webhook(payload({ leadId: '99-CONCURRENT-1' }))));
    assert.equal(new Set(responses.map((response) => response.body.lead.id)).size, 1);
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
  });

  it('keeps multiple legitimate enquiries from the same customer', async () => {
    const first = await webhook(payload({ leadId: '99-MULTI-1', propertyName: property.name }));
    const second = await webhook(payload({ leadId: '99-MULTI-2', propertyName: 'Another 99acres Tower' }));
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(first.body.lead.customer.id, second.body.lead.customer.id);
    assert.notEqual(first.body.lead.id, second.body.lead.id);
  });

  it('rejects invalid payloads and non-JSON requests', async () => {
    assert.equal((await webhook({ name: 'No mobile', propertyName: property.name })).status, 400);
    const response = await fetch(`${t.base}/api/v1/webhooks/99acres/leads`, { method: 'POST', body: 'not-json', headers: { 'content-type': 'text/plain' } });
    assert.equal(response.status, 415);
  });

  it('does not require or interpret an authorization header', async () => {
    const response = await webhook(payload({ leadId: '99-NO-AUTH-1' }), { authorization: 'Bearer not-a-real-token' });
    assert.equal(response.status, 201);
  });
});

describe('99acres webhook controls', () => {
  it('enforces the route body limit and rate limit', async () => {
    const server: Server = (await import('../src/app')).createApp(undefined, { acres99RateLimitMax: 1 }).listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const oversized = await fetch(`${base}/api/v1/webhooks/99acres/leads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x'.repeat(40_000), mobile: '9876543210', propertyName: 'Oversized' }),
      });
      assert.equal(oversized.status, 413);
      const first = await fetch(`${base}/api/v1/webhooks/99acres/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const second = await fetch(`${base}/api/v1/webhooks/99acres/leads`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(first.status, 400);
      assert.equal(second.status, 429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
