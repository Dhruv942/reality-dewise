import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectService, propertyService, teamService, userService } from '../src/services/crudServices';
import { convertToLead, createEnquiry, findMatchingProperties } from '../src/services/enquiryService';

test('Direct Quick Enquiry creation, Property matching, and Conversion to Lead', async () => {
  const suffix = Math.floor(Math.random() * 10000);

  // Setup Team & Executive & Project
  const team = await teamService.create({ name: `Enquiry Team ${suffix}` });
  const exec = await userService.create({ name: `Exec ${suffix}`, teamId: team.id, isActive: true });
  const project = await projectService.create({ name: `Grand Residency ${suffix}`, teamId: team.id });

  // Setup Inventory / Property
  const property = await propertyService.create({
    projectId: project.id,
    unitNumber: `A-${suffix}`,
    bhk: 2,
    price: 6500000,
    availability: 'AVAILABLE',
  });

  // 1. Executive creates Quick Enquiry from direct call
  const mobile = `91234${Math.floor(10000 + Math.random() * 89999)}`;
  const enquiry = await createEnquiry({
    name: 'Direct Customer',
    mobile: mobile,
    requirement: '2 BHK',
    bhk: 2,
    budget: 7000000,
    projectId: project.id,
    notes: 'Called directly asking for 2 BHK',
  });

  assert.equal(enquiry.status, 'PENDING');
  assert.equal(enquiry.mobile, mobile);

  // 2. Match suitable property/inventory
  const matches = await findMatchingProperties(enquiry.id);
  assert.ok(matches.length >= 1, 'Should find matching property');
  assert.equal(matches[0]?.id, property.id);

  // 3. Convert Enquiry to Lead
  const conversionResult = await convertToLead(enquiry.id, { propertyId: property.id });

  assert.equal(conversionResult.enquiry?.status, 'CONVERTED');
  assert.equal(conversionResult.lead.enquiryId, enquiry.id);
  assert.equal(conversionResult.lead.source, 'direct');
  assert.equal(conversionResult.lead.assignedTo, exec.id);
  assert.equal(conversionResult.customer.mobile, mobile);
});
