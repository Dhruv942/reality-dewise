import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { teamService, projectService, userService } from '../src/services/crudServices';

test('REST API End-to-End Test Suite', async () => {
  const app = createApp();
  const server = app.listen(0);
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}/api/v1`;

  try {
    const suffix = Math.floor(Math.random() * 10000);

    // 1. Create team, user, project via API
    const teamRes = await fetch(`${baseUrl}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `API Team ${suffix}` }),
    });
    assert.equal(teamRes.status, 201);
    const team = await teamRes.json();

    const userRes = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `API Exec ${suffix}`, teamId: team.id }),
    });
    assert.equal(userRes.status, 201);

    const projectRes = await fetch(`${baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `API Residency ${suffix}`, teamId: team.id }),
    });
    assert.equal(projectRes.status, 201);
    const project = await projectRes.json();

    // 2. Ingest portal lead via POST /api/v1/leads
    const mobile = `99999${Math.floor(10000 + Math.random() * 89999)}`;
    const leadRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Portal Lead Customer',
        mobile: mobile,
        projectId: project.id,
        source: '99acres',
        externalId: `99a_${suffix}`,
        budget: 7000000,
        requirement: '2 BHK',
      }),
    });
    assert.equal(leadRes.status, 201);
    const leadData = await leadRes.json();
    assert.ok(leadData.lead.id);
    assert.equal(leadData.isExistingCustomer, false);

    // Replay duplicate lead -> should return 200 with duplicate: true
    const replayRes = await fetch(`${baseUrl}/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Portal Lead Customer',
        mobile: mobile,
        projectId: project.id,
        source: '99acres',
        externalId: `99a_${suffix}`,
      }),
    });
    assert.equal(replayRes.status, 200);
    const replayData = await replayRes.json();
    assert.equal(replayData.duplicate, true);

    // 3. Contact lead via POST /api/v1/leads/:id/contact
    const contactRes = await fetch(`${baseUrl}/leads/${leadData.lead.id}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notes: 'Contacted customer, interested in site visit',
        nextFollowUpAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    assert.equal(contactRes.status, 200);
    const updatedLead = await contactRes.json();
    assert.equal(updatedLead.status, 'FOLLOW_UP');

    // 4. Create Quick Enquiry via POST /api/v1/enquiries
    const enquiryRes = await fetch(`${baseUrl}/enquiries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Walkin Customer',
        mobile: `98888${Math.floor(10000 + Math.random() * 89999)}`,
        requirement: '3 BHK',
        projectId: project.id,
      }),
    });
    assert.equal(enquiryRes.status, 201);
    const enquiry = await enquiryRes.json();

    // Convert Quick Enquiry -> Lead via POST /api/v1/enquiries/:id/convert-to-lead
    const convertRes = await fetch(`${baseUrl}/enquiries/${enquiry.id}/convert-to-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: project.id }),
    });
    assert.equal(convertRes.status, 201);
    const convertResult = await convertRes.json();
    assert.equal(convertResult.enquiry.status, 'CONVERTED');
    assert.equal(convertResult.lead.source, 'direct');

    // 5. Get Dashboard Summary via GET /api/v1/dashboard/summary
    const dashRes = await fetch(`${baseUrl}/dashboard/summary`);
    assert.equal(dashRes.status, 200);
    const dashData = await dashRes.json();
    assert.ok(dashData.data.totalLeads >= 2);
  } finally {
    server.close();
  }
});
