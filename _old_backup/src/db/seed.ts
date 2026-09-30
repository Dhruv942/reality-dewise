import { insertRow, pool } from './pool';
import { contactLead } from '../services/contactService';
import { createEnquiry } from '../services/enquiryService';
import { createLead } from '../services/leadService';
import { updateLeadStatus } from '../services/leadService';

const LAKH = 100_000;
const CRORE = 100 * LAKH;

/** Wipes all CRM data and loads a small, realistic demo dataset (run through the real services). */
export async function resetAndSeed(): Promise<void> {
  await pool.query(
    `TRUNCATE notifications, follow_ups, lead_notes, lead_status_history, lead_assignments, leads, enquiries,
              properties, customers, projects, users, teams RESTART IDENTITY CASCADE`);

  const team = await insertRow<{ id: number }>(pool, 'teams', { name: 'Team A' });
  for (const [name, mobile] of [['Amit', '9000000001'], ['Raj', '9000000002'], ['Neha', '9000000003']]) {
    await insertRow(pool, 'users', { name, mobile, email: `${name.toLowerCase()}@example.com`, teamId: team.id });
  }
  const abc = await insertRow<{ id: number }>(pool, 'projects', { name: 'ABC Residency', location: 'Andheri West, Mumbai', teamId: team.id });
  const green = await insertRow<{ id: number }>(pool, 'projects', { name: 'Green Meadows', location: 'Hinjewadi, Pune', teamId: team.id });

  const props = [
    [abc.id, 'A-101', 2, 70 * LAKH], [abc.id, 'A-202', 3, 95 * LAKH],
    [green.id, 'G-102', 2, 68 * LAKH], [green.id, 'G-301', 3, 1.2 * CRORE],
  ] as const;
  for (const [projectId, unitNumber, bhk, price] of props) {
    await insertRow(pool, 'properties', { projectId, unitNumber, bhk, price });
  }

  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  const lead = (name: string, mobile: string, projectName: string, source: string, requirement: string, budget: number, metadata: Record<string, unknown> = {}) =>
    createLead({ name, mobile, projectName, source, requirement, budget, metadata });

  const rahul = await lead('Rahul Patel', '9876500001', 'ABC Residency', '99acres', '2 BHK in ABC Residency, ready to move', 70 * LAKH,
    { propertyType: '2 BHK', category: 'Residential', location: 'Andheri West, Mumbai', purpose: 'Purchase', fundingSource: 'Home Loan' });
  await contactLead(rahul.lead.id, { notes: 'Customer interested in 2 BHK, wants site visit next week.', nextFollowUpAt: tomorrow });

  await lead('Priya Sharma', '9876500002', 'Green Meadows', 'Magicbricks', '3 BHK with parking', 1.2 * CRORE, { propertyType: '3 BHK', category: 'Residential' });

  const karan = await lead('Karan Mehta', '9876500003', 'ABC Residency', 'Housing', '2 BHK, budget is tight', 65 * LAKH, { propertyType: '2 BHK' });
  await contactLead(karan.lead.id, { notes: 'Budget is below current inventory pricing.' });

  const vikram = await lead('Vikram Rao', '9876500005', 'Green Meadows', '99acres', '3 BHK in Green Meadows', 1.1 * CRORE, { propertyType: '3 BHK' });
  await contactLead(vikram.lead.id, { notes: 'Went ahead with a competitor project.' });
  await updateLeadStatus(vikram.lead.id, 'LOST', { reason: 'Chose a competitor' });

  await lead('Sneha Iyer', '9876500006', 'ABC Residency', 'Referral', '3 BHK for family', 95 * LAKH, { propertyType: '3 BHK' });
  // Same customer as Karan, different project: shows duplicate detection + past-connects history.
  await lead('Karan Mehta', '9876500003', 'Green Meadows', 'Magicbricks', 'Also looking at Pune', 68 * LAKH, { propertyType: '2 BHK' });

  await createEnquiry({
    name: 'Manoj Kumar', mobile: '9876500009', requirement: 'Looking for 2/3 BHK near ABC Residency',
    budget: 80 * LAKH, metadata: { type: 'Residential' },
  });

  // Demo mode: new leads get a 1 minute SLA so automatic reassignment can be shown live.
  // (Seeded leads above already carry their normal 45 minute windows.)
  await pool.query(`UPDATE projects SET sla_minutes = 1`);
}

if (require.main === module) {
  resetAndSeed()
    .then(() => console.log('[SEED] demo data loaded'))
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => pool.end());
}
