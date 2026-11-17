import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;

before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('Zoho OAuth callback', () => {
  it('accepts a callback code and state without returning either secret', async () => {
    const response = await t.call('/auth/zoho/callback?code=authorization-code-123&state=state-123');
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { success: false, message: 'Zoho Mail integration is not configured' });
    assert.equal(JSON.stringify(response.body).includes('authorization-code-123'), false);
    assert.equal(JSON.stringify(response.body).includes('state-123'), false);
  });

  it('validates missing parameters and returns Zoho errors without echoing sensitive values', async () => {
    const missing = await t.call('/auth/zoho/callback?state=state-123');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.message, 'Validation failed');
    assert.deepEqual(missing.body.errors, [{ field: 'code', message: 'OAuth code is required' }]);

    const providerError = await t.call('/auth/zoho/callback?error=access_denied&error_description=User+denied+access');
    assert.equal(providerError.status, 400);
    assert.equal(providerError.body.message, 'Zoho authorization was not granted');
    assert.equal(JSON.stringify(providerError.body).includes('access_denied'), false);
    assert.equal(JSON.stringify(providerError.body).includes('User denied access'), false);
  });
});
