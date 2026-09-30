import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let teamA: any, teamB: any, amit: any, rahul: any, bob: any;

before(async () => {
  t = await startTestApp();
  teamA = await t.team('Team A');
  teamB = await t.team('Team B');
  amit = await t.exec('amit', teamA.id);
  rahul = await t.exec('rahul', teamA.id);
  bob = await t.exec('bob', teamB.id);
});
after(() => t.close());

const base = { externalPropertyId: 'MB12345', source: '99ACRES', name: 'XYZ Residency', description: '2 BHK residential property', location: 'Ahmedabad' };

describe('property CRUD', () => {
  let id: string;

  it('create manually with team + primary executive', async () => {
    const r = await t.call('/admin/properties', 'POST', { ...base, teamId: teamA.id, primaryExecutiveId: amit.id });
    assert.equal(r.status, 201);
    id = r.body.id;
    assert.equal(r.body.externalPropertyId, 'MB12345');
    assert.equal(r.body.source, '99ACRES');
    assert.equal(r.body.isActive, true);
    assert.equal(r.body.team.name, 'Team A');
    assert.equal(r.body.primaryExecutive.name, 'Amit');
  });
  it('same external id under another source is a different property', async () => {
    const r = await t.call('/admin/properties', 'POST', { ...base, source: 'magicbricks' });
    assert.equal(r.status, 201);
    assert.equal(r.body.source, 'MAGICBRICKS');
    assert.equal(r.body.team, null);
    assert.equal(r.body.primaryExecutive, null);
  });
  it('duplicate (source, external id) -> 409', async () => {
    const r = await t.call('/admin/properties', 'POST', { ...base, name: 'Other' });
    assert.equal(r.status, 409);
    assert.equal(r.body.message, 'A property with this source and external ID already exists');
  });
  it('create with a team only, and create inactive', async () => {
    const r = await t.call('/admin/properties', 'POST', { ...base, externalPropertyId: 'T1', teamId: teamA.id, isActive: false });
    assert.equal(r.status, 201);
    assert.equal(r.body.primaryExecutive, null);
    assert.equal(r.body.isActive, false);
  });
  it('create validation: source, missing fields, primary without team, extra fields', async () => {
    const bad = async (body: object) => (await t.call('/admin/properties', 'POST', body)).status;
    assert.equal(await bad({ ...base, externalPropertyId: 'V1', source: 'HOUSING' }), 400);
    assert.equal(await bad({ source: '99ACRES' }), 400);
    assert.equal(await bad({ ...base, externalPropertyId: 'V2', primaryExecutiveId: amit.id }), 400);
    assert.equal(await bad({ ...base, externalPropertyId: 'V3', id: ZERO }), 400);
  });
  it('create rejects primary executive from another team / inactive / unknown; team inactive/unknown', async () => {
    const mk = async (extra: object) => t.call('/admin/properties', 'POST', { ...base, externalPropertyId: 'R' + Math.random(), ...extra });
    const wrongTeam = await mk({ teamId: teamA.id, primaryExecutiveId: bob.id });
    assert.equal(wrongTeam.status, 409);
    assert.equal(wrongTeam.body.message, "Executive does not belong to the property's team");
    assert.equal((await mk({ teamId: teamA.id, primaryExecutiveId: ZERO })).status, 400);
    assert.equal((await mk({ teamId: ZERO })).status, 400);
    const idle = await t.exec('idle', teamA.id);
    await t.setActive(idle.id, false);
    assert.equal((await mk({ teamId: teamA.id, primaryExecutiveId: idle.id })).body.message, 'Executive is inactive');
    const dead = await t.team('Dead');
    await t.call(`/admin/teams/${dead.id}/status`, 'PATCH', { isActive: false });
    assert.equal((await mk({ teamId: dead.id })).status, 409);
    assert.equal((await t.call('/admin/properties?search=R0.')).body.length, 0, 'no partial rows');
  });
  it('get single: team, primary and current active team executives', async () => {
    const r = await t.call(`/admin/properties/${id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.team.id, teamA.id);
    assert.equal(r.body.primaryExecutive.id, amit.id);
    assert.deepEqual(r.body.activeTeamExecutives.map((e: any) => e.username), ['amit', 'rahul']); // idle is inactive
    assert.equal((await t.call(`/admin/properties/${ZERO}`)).status, 404);
    assert.equal((await t.call('/admin/properties/xyz')).status, 400);
  });
  it('list + filters', async () => {
    assert.equal((await t.call('/admin/properties')).body.length, 3);
    assert.equal((await t.call('/admin/properties?source=MAGICBRICKS')).body.length, 1);
    assert.equal((await t.call(`/admin/properties?teamId=${teamA.id}`)).body.length, 2);
    assert.equal((await t.call('/admin/properties?isActive=false')).body.length, 1);
    assert.equal((await t.call('/admin/properties?search=xyz')).body.length, 3);
    assert.equal((await t.call('/admin/properties?source=NOPE')).status, 400);
  });
  it('update details; identity/assignment fields are rejected', async () => {
    const r = await t.call(`/admin/properties/${id}`, 'PATCH', { name: 'XYZ Heights', location: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'XYZ Heights');
    assert.equal(r.body.location, null);
    for (const bad of [{ source: 'MAGICBRICKS' }, { externalPropertyId: 'X' }, { teamId: teamB.id }, { primaryExecutiveId: null }, {}]) {
      assert.equal((await t.call(`/admin/properties/${id}`, 'PATCH', bad)).status, 400);
    }
  });
  it('deactivate keeps the row', async () => {
    const r = await t.call(`/admin/properties/${id}/status`, 'PATCH', { isActive: false });
    assert.equal(r.body.isActive, false);
    assert.equal((await t.call(`/admin/properties/${id}`)).status, 200);
    await t.call(`/admin/properties/${id}/status`, 'PATCH', { isActive: true });
    assert.equal((await t.call(`/admin/properties/${id}/status`, 'PATCH', { isActive: 'x' })).status, 400);
  });
});

describe('team + primary executive assignment', () => {
  let p: any;
  before(async () => { p = await t.property({ ...base, externalPropertyId: 'ASSIGN1' }); });

  it('primary executive needs a team first', async () => {
    const r = await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: amit.id });
    assert.equal(r.status, 409);
  });
  it('assign team (inactive/unknown team rejected)', async () => {
    assert.equal((await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: ZERO })).status, 400);
    const dead = (await t.call('/admin/teams?search=Dead')).body[0];
    assert.equal((await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: dead.id })).status, 409);
    const r = await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamA.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.team.id, teamA.id);
    assert.equal((await t.call(`/admin/properties/${ZERO}/team`, 'PATCH', { teamId: teamA.id })).status, 404);
  });
  it('assign primary executive of the team', async () => {
    const r = await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: amit.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.primaryExecutive.id, amit.id);
  });
  it('reject executive from another team / inactive / unknown / property unknown', async () => {
    const wrong = await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: bob.id });
    assert.equal(wrong.status, 409);
    const idle = (await t.call('/admin/executives?search=idle')).body[0];
    assert.equal((await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: idle.id })).status, 409);
    assert.equal((await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: ZERO })).status, 400);
    assert.equal((await t.call(`/admin/properties/${ZERO}/executive`, 'PATCH', { executiveId: amit.id })).status, 404);
    assert.equal((await t.call(`/admin/properties/${p.id}`)).body.primaryExecutive.id, amit.id, 'unchanged');
  });
  it('team change with a mismatching primary is refused with guidance; nobody is moved', async () => {
    const r = await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamB.id });
    assert.equal(r.status, 409);
    assert.equal(r.body.errors.code, 'PRIMARY_EXECUTIVE_TEAM_MISMATCH');
    assert.equal(r.body.errors.resolution.length, 2);
    const after = await t.call(`/admin/properties/${p.id}`);
    assert.equal(after.body.team.id, teamA.id);
    assert.equal(after.body.primaryExecutive.id, amit.id);
    assert.equal((await t.call(`/admin/executives/${amit.id}`)).body.team.id, teamA.id);
  });
  it('team change resolved in the same request: new primary from the new team', async () => {
    // a primary from the OLD team is still invalid
    assert.equal((await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamB.id, primaryExecutiveId: rahul.id })).status, 409);
    const r = await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamB.id, primaryExecutiveId: bob.id });
    assert.equal(r.status, 200);
    assert.equal(r.body.team.id, teamB.id);
    assert.equal(r.body.primaryExecutive.id, bob.id);
  });
  it('team change resolved by removing the primary (null)', async () => {
    const r = await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamA.id, primaryExecutiveId: null });
    assert.equal(r.status, 200);
    assert.equal(r.body.team.id, teamA.id);
    assert.equal(r.body.primaryExecutive, null);
  });
  it('team change with no primary needs no resolution', async () => {
    assert.equal((await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamB.id })).status, 200);
    await t.call(`/admin/properties/${p.id}/team`, 'PATCH', { teamId: teamA.id });
  });
  it('remove primary executive', async () => {
    await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: amit.id });
    const r = await t.call(`/admin/properties/${p.id}/executive`, 'DELETE');
    assert.equal(r.status, 200);
    assert.equal(r.body.primaryExecutive, null);
    assert.equal(r.body.team.id, teamA.id, 'team kept');
  });
  it('executive who is a primary cannot be moved out of the property team (API + DB)', async () => {
    await t.call(`/admin/properties/${p.id}/executive`, 'PATCH', { executiveId: amit.id });
    const r = await t.call(`/admin/executives/${amit.id}/team`, 'PATCH', { teamId: teamB.id });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /primary executive of \d+ propert/);
    assert.equal((await t.call(`/admin/executives/${amit.id}/team`, 'DELETE')).status, 409);
    assert.equal((await t.call(`/admin/executives/${amit.id}`, 'PATCH', { teamId: teamB.id })).status, 409);
    await assert.rejects(pool.query('UPDATE users SET team_id=$1 WHERE id=$2', [teamB.id, amit.id]), /properties_primary_in_team_fkey/);
    await assert.rejects(pool.query('UPDATE properties SET primary_executive_id=$1 WHERE id=$2', [bob.id, p.id]), /properties_primary_in_team_fkey/);
    // deactivating/soft-deleting is fine: the property just falls back to round robin
    assert.equal((await t.setActive(amit.id, false)).status, 200);
    await t.setActive(amit.id, true);
    await pool.query('UPDATE properties SET primary_executive_id = NULL WHERE primary_executive_id = $1', [amit.id]);
    assert.equal((await t.call(`/admin/executives/${amit.id}/team`, 'PATCH', { teamId: teamB.id })).status, 200);
    await t.call(`/admin/executives/${amit.id}/team`, 'PATCH', { teamId: teamA.id });
  });
});
