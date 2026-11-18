import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env';
import { pool } from '../src/database/pool';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let property: { id: string; name: string };
const SECRET = 'test-webhook-secret-1234';

const post = async (portal: string, body: unknown, headers: Record<string, string> = {}, query = '') => {
  const res = await fetch(`${t.base}/api/v1/webhooks/${portal}/leads${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const valid = (extra: object = {}) => ({ name: 'Hardening Buyer', mobile: '9876500001', propertyName: property.name, ...extra });
const events = async (source: string) => (await pool.query('SELECT * FROM webhook_events WHERE source = $1 ORDER BY received_at', [source])).rows;

before(async () => {
  env.ACRES99_WEBHOOK_SECRET = SECRET;
  t = await startTestApp();
  await pool.query('TRUNCATE webhook_events');
  property = await t.property('Hardening Heights', [(await t.exec('hardening-exec')).id]);
});
after(async () => {
  delete env.ACRES99_WEBHOOK_SECRET;
  await t.close();
});

describe('webhook secret', () => {
  it('rejects a missing or wrong secret and stores nothing', async () => {
    assert.equal((await post('99acres', valid())).status, 401);
    assert.equal((await post('99acres', valid(), { 'x-webhook-secret': 'wrong-secret-wrong-secret' })).status, 401);
    assert.equal((await events('99ACRES')).length, 0);
  });
  it('accepts the secret as header, bearer token or query token', async () => {
    assert.equal((await post('99acres', valid({ leadId: 'S-1' }), { 'x-webhook-secret': SECRET })).status, 201);
    assert.equal((await post('99acres', valid({ leadId: 'S-2' }), { authorization: `Bearer ${SECRET}` })).status, 201);
    assert.equal((await post('99acres', valid({ leadId: 'S-3' }), {}, `?token=${SECRET}`)).status, 201);
  });
  it('leaves a portal without a configured secret open', async () => {
    assert.equal((await post('magicbricks', valid({ leadId: 'M-OPEN' }))).status, 201);
  });
});

describe('webhook events', () => {
  it('keeps the raw payload of a rejected webhook as FAILED', async () => {
    const bad = { name: 'No Phone', propertyName: property.name, marker: 'rejected-payload' };
    const res = await post('99acres', bad, { 'x-webhook-secret': SECRET });
    assert.equal(res.status, 400);
    const row = (await events('99ACRES')).find((e) => e.payload?.marker === 'rejected-payload');
    assert.ok(row);
    assert.equal(row.status, 'FAILED');
    assert.match(row.error, /mobile|Mobile/i);
    assert.equal(row.lead_id, null);
  });
  it('marks a created lead PROCESSED and a repeat DUPLICATE', async () => {
    const body = valid({ leadId: 'EV-1', mobile: '9876500002' });
    const first = await post('99acres', body, { 'x-webhook-secret': SECRET });
    const second = await post('99acres', body, { 'x-webhook-secret': SECRET });
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    const rows = (await events('99ACRES')).filter((e) => e.payload?.leadId === 'EV-1');
    assert.deepEqual(rows.map((r) => r.status), ['PROCESSED', 'DUPLICATE']);
    assert.ok(rows.every((r) => r.lead_id === first.body.leadId));
  });
});

describe('retry dedupe without vendor id or timestamp', () => {
  it('treats the same enquiry delivered twice as one lead', async () => {
    const body = valid({ mobile: '9876500003', message: 'same message' });
    const first = await post('magicbricks', body);
    const second = await post('magicbricks', body);
    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.leadId, first.body.leadId);
  });
});

describe('liveness', () => {
  it('answers /health/live without the database', async () => {
    const res = await fetch(`${t.base}/health/live`);
    assert.equal(res.status, 200);
  });
});
