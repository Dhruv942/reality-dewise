import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool';
import { findOrCreateCustomer } from '../src/services/customerService';
import { createLeadInTx } from '../src/services/leadService';
import { projectService, teamService } from '../src/services/crudServices';

test('Duplicate customer detection & reuse', async () => {
  const testMobile = `9${Math.floor(100000000 + Math.random() * 900000000)}`;

  // 1. Create first customer
  const res1 = await withTransaction((tx) =>
    findOrCreateCustomer(tx, { name: 'Rahul Patel', mobile: testMobile, email: 'rahul@example.com' })
  );
  assert.equal(res1.created, true);
  assert.equal(res1.customer.name, 'Rahul Patel');
  assert.equal(res1.customer.mobile, testMobile);

  // 2. Call again with exact same mobile number
  const res2 = await withTransaction((tx) =>
    findOrCreateCustomer(tx, { name: 'Rahul P.', mobile: testMobile, email: 'rahul.new@example.com' })
  );
  assert.equal(res2.created, false);
  assert.equal(res2.customer.id, res1.customer.id);
  // Existing customer name should remain untouched
  assert.equal(res2.customer.name, 'Rahul Patel');
});
