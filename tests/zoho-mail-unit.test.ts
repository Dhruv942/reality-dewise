import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, hashOAuthState } from '../src/modules/zoho/zoho.crypto';
import { assignmentEmail } from '../src/modules/email-notifications/email-notification.template';

describe('Zoho Mail backend primitives', () => {
  it('encrypts refresh-token material and can decrypt it without exposing plaintext in the ciphertext', () => {
    const encrypted = encryptSecret('refresh-token-value', 'a'.repeat(32));
    assert.notEqual(encrypted, 'refresh-token-value');
    assert.equal(encrypted.includes('refresh-token-value'), false);
    assert.equal(decryptSecret(encrypted, 'a'.repeat(32)), 'refresh-token-value');
    assert.throws(() => decryptSecret(encrypted, 'b'.repeat(32)));
  });

  it('hashes OAuth state deterministically for one-time server-side storage', () => {
    assert.equal(hashOAuthState('state-1'), hashOAuthState('state-1'));
    assert.notEqual(hashOAuthState('state-1'), hashOAuthState('state-2'));
  });

  it('escapes dynamic email fields and produces a plaintext fallback', () => {
    const email = assignmentEmail({
      executiveName: '<A>', leadName: '<Customer>', leadNo: '12', leadType: 'BROKER_AGENT', mobile: '+919000012345', email: 'customer@example.com',
      projectName: '<Project>', propertyName: 'A & B', enquiryType: 'PROJECT', budget: 2500000, source: 'MANUAL (WALK_IN)', assignedAt: new Date('2026-11-17T10:00:00Z'),
    });
    assert.equal(email.htmlContent.includes('&lt;Customer&gt;'), true);
    assert.equal(email.htmlContent.includes('<Customer>'), false);
    assert.equal(email.textContent.includes('Name: <Customer>'), true);
    assert.equal(email.textContent.includes('Type: BROKER_AGENT'), true);
    assert.equal(email.textContent.includes('Number: +919000012345'), true);
    assert.equal(email.textContent.includes('Email ID: customer@example.com'), true);
    assert.equal(email.textContent.includes('Project Name: <Project>'), true);
    assert.equal(email.textContent.includes('Enquiry: Project'), true);
    assert.equal(email.textContent.includes('Budget: ₹25,00,000'), true);
    assert.equal(email.subject, 'New Lead Assigned | Realty Adwise CRM');
  });
});
