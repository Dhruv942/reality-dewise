import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/db/pool';
import { projectService, teamService, userService } from '../src/services/crudServices';
import { createLead, getLeadHistory } from '../src/services/leadService';
import { contactLead } from '../src/services/contactService';
import { processExpiredAssignments } from '../src/services/slaService';

test('Lead creation, Round-Robin assignment, Contact, and SLA auto-reassignment', async () => {
  const suffix = Math.floor(Math.random() * 10000);
  
  // 1. Setup Team and Executives: Amit, Jay, Rahul, Priya
  const team = await teamService.create({ name: `Sales Team ${suffix}` });
  const exec1 = await userService.create({ name: `Amit ${suffix}`, teamId: team.id, isActive: true });
  const exec2 = await userService.create({ name: `Jay ${suffix}`, teamId: team.id, isActive: true });
  const exec3 = await userService.create({ name: `Rahul ${suffix}`, teamId: team.id, isActive: true });
  const exec4 = await userService.create({ name: `Priya ${suffix}`, teamId: team.id, isActive: true });

  // 2. Setup Project associated with Team
  const project = await projectService.create({
    name: `ABC Residency ${suffix}`,
    teamId: team.id,
    slaMinutes: 45,
  });

  // 3. Test Round-Robin distribution: Lead 1 -> Amit, Lead 2 -> Jay, Lead 3 -> Rahul, Lead 4 -> Priya, Lead 5 -> Amit
  const mobile1 = `98765${Math.floor(10005 + Math.random() * 80000)}`;
  const lead1Res = await createLead({
    name: 'Customer 1',
    mobile: mobile1,
    projectId: project.id,
    budget: 7000000,
    source: '99acres',
    requirement: '2 BHK',
  });
  assert.equal(lead1Res.lead.assignedTo, exec1.id, 'Lead 1 should be assigned to Amit');

  const mobile2 = `98765${Math.floor(10005 + Math.random() * 80000)}`;
  const lead2Res = await createLead({
    name: 'Customer 2',
    mobile: mobile2,
    projectId: project.id,
    budget: 8000000,
    source: 'Magicbricks',
    requirement: '3 BHK',
  });
  assert.equal(lead2Res.lead.assignedTo, exec2.id, 'Lead 2 should be assigned to Jay');

  const mobile3 = `98765${Math.floor(10005 + Math.random() * 80000)}`;
  const lead3Res = await createLead({
    name: 'Customer 3',
    mobile: mobile3,
    projectId: project.id,
    budget: 9000000,
    source: '99acres',
  });
  assert.equal(lead3Res.lead.assignedTo, exec3.id, 'Lead 3 should be assigned to Rahul');

  const mobile4 = `98765${Math.floor(10005 + Math.random() * 80000)}`;
  const lead4Res = await createLead({
    name: 'Customer 4',
    mobile: mobile4,
    projectId: project.id,
    budget: 5000000,
    source: 'Magicbricks',
  });
  assert.equal(lead4Res.lead.assignedTo, exec4.id, 'Lead 4 should be assigned to Priya');

  const mobile5 = `98765${Math.floor(10005 + Math.random() * 80000)}`;
  const lead5Res = await createLead({
    name: 'Customer 5',
    mobile: mobile5,
    projectId: project.id,
    budget: 7500000,
    source: '99acres',
  });
  assert.equal(lead5Res.lead.assignedTo, exec1.id, 'Lead 5 should wrap back and be assigned to Amit');

  // 4. Test Executive Contacting Customer (Lead 1)
  const contactedLead = await contactLead(lead1Res.lead.id, {
    notes: 'Customer interested in 2 BHK on higher floor.',
    nextFollowUpAt: new Date(Date.now() + 86400000), // 1 day later
  });
  assert.equal(contactedLead.status, 'FOLLOW_UP');
  assert.notEqual(contactedLead.contactedAt, null);

  // 5. Test SLA Expiration & Auto Reassignment on Lead 2
  // Manually force Lead 2 assignment sla_deadline into the past
  await pool.query(
    `UPDATE lead_assignments SET sla_deadline = now() - interval '10 minutes' WHERE lead_id = $1 AND status = 'ACTIVE'`,
    [lead2Res.lead.id]
  );

  // Process expired assignments
  const processed = await processExpiredAssignments();
  assert.ok(processed >= 1, 'Should process at least 1 expired assignment');

  // Lead 2 was previously assigned to Jay (exec2). Next in round-robin after Jay should be Rahul (exec3)
  const history = await getLeadHistory(lead2Res.lead.id);
  assert.equal(history.assignments.length, 2, 'Lead 2 should have 2 assignment history records');
  assert.equal(history.assignments[0]?.status, 'SLA_EXPIRED');
  assert.equal(history.assignments[1]?.status, 'ACTIVE');
  assert.equal(history.assignments[1]?.userId, exec3.id, 'Lead 2 should be reassigned to Rahul');
});
