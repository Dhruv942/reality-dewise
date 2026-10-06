import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { PropertyAssignmentService, propertyAssignmentService as svc } from '../src/modules/assignment/assignment.service';
import type { AvailabilityService } from '../src/modules/assignment/availability.service';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let n = 0;
const assign = async (propertyId: string) => svc.assignLeadToProperty(propertyId, await t.makeLead());
const who = async (propertyId: string) => (await assign(propertyId))?.executiveId;
const newProperty = (executiveIds: string[] = [], isActive = true) => t.property(`Property ${++n}`, executiveIds, isActive);
const rotation = async (propertyId: string, times: number) => {
  const out: (string | undefined)[] = [];
  for (let i = 0; i < times; i++) out.push(await who(propertyId));
  return out;
};

before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('round-robin over the executives picked for the property', () => {
  it('Amit, Rahul, Priya, Amit, Rahul ...; executives not on the list never receive leads', async () => {
    const team = await t.team('Team A');
    const amit = await t.exec('amit', team.id);
    const rahul = await t.exec('rahul', team.id);
    const priya = await t.exec('priya', team.id);
    const bystander = await t.exec('bystander', team.id); // same team, NOT picked
    const p = await newProperty([amit.id, rahul.id, priya.id]);
    assert.deepEqual(await rotation(p.id, 5), [amit.id, rahul.id, priya.id, amit.id, rahul.id]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM property_assignment_history WHERE executive_id=$1', [bystander.id])).rows[0].n, 0);
  });

  it('each property rotates independently', async () => {
    const a = await t.exec('ind.a');
    const b = await t.exec('ind.b');
    const p1 = await newProperty([a.id, b.id]);
    const p2 = await newProperty([a.id, b.id]);
    assert.equal(await who(p1.id), a.id);
    assert.equal(await who(p1.id), b.id);
    assert.equal(await who(p2.id), a.id, 'p2 starts from the beginning');
  });

  it('unavailable executives are skipped and rejoin when active again', async () => {
    const a = await t.exec('av.a');
    const b = await t.exec('av.b');
    const c = await t.exec('av.c');
    const p = await newProperty([a.id, b.id, c.id]);
    assert.equal(await who(p.id), a.id);
    await t.setActive(b.id, false);
    assert.equal(await who(p.id), c.id, 'b skipped');
    assert.equal(await who(p.id), a.id);
    await t.setActive(b.id, true);
    assert.equal(await who(p.id), b.id);
  });

  it('nobody to assign -> null: no executives picked, or all of them unavailable', async () => {
    const x = await t.exec('none.x');
    assert.equal(await assign((await newProperty()).id), null);
    const p = await newProperty([x.id]);
    await t.setActive(x.id, false);
    assert.equal(await assign(p.id), null);
  });

  it('pointer survives the last-assigned executive being removed from the list', async () => {
    const a = await t.exec('rm.a');
    const b = await t.exec('rm.b');
    const c = await t.exec('rm.c');
    const p = await newProperty([a.id, b.id, c.id]);
    assert.equal(await who(p.id), a.id);
    assert.equal(await who(p.id), b.id);
    await t.call(`/admin/properties/${p.id}/executives`, 'PUT', { executiveIds: [a.id, c.id] });
    assert.equal(await who(p.id), c.id);
    assert.equal(await who(p.id), a.id);
  });

  it('unknown property 404, inactive property 409', async () => {
    await assert.rejects(svc.assignLeadToProperty(ZERO, await t.makeLead()), /Property not found/);
    const e = await t.exec('inact.e');
    const off = await newProperty([e.id], false);
    await assert.rejects(assign(off.id), /inactive/);
  });
});

describe('idempotency and history', () => {
  it('the same lead is assigned once, retries return the same executive and do not rotate', async () => {
    const a = await t.exec('id.a');
    const b = await t.exec('id.b');
    const p = await newProperty([a.id, b.id]);
    const lead = await t.makeLead();
    const first = await svc.assignLeadToProperty(p.id, lead);
    const again = await svc.assignLeadToProperty(p.id, lead);
    assert.equal(first?.alreadyAssigned, false);
    assert.equal(again?.alreadyAssigned, true);
    assert.equal(again?.executiveId, first?.executiveId);
    assert.equal(await who(p.id), b.id, 'the retry did not consume a turn');
    const parallel = await Promise.all(Array.from({ length: 8 }, () => svc.assignLeadToProperty(p.id, lead)));
    assert.equal(new Set(parallel.map((r) => r?.executiveId)).size, 1);
    assert.equal((await pool.query('SELECT count(*)::int n FROM property_assignment_history WHERE lead_id=$1', [lead])).rows[0].n, 1);
  });

  it('history is listed per property, newest first', async () => {
    const a = await t.exec('h.a');
    const p = await newProperty([a.id]);
    await rotation(p.id, 3);
    const h = (await t.call(`/admin/properties/${p.id}/assignment-history`)).body;
    assert.equal(h.history.length, 3);
    assert.equal(h.history[0].executive.id, a.id);
  });
});

describe('concurrency and pluggable availability', () => {
  it('30 parallel leads spread evenly over 3 executives', async () => {
    const es = [await t.exec('cc.a'), await t.exec('cc.b'), await t.exec('cc.c')];
    const p = await newProperty(es.map((e) => e.id));
    const leads = await Promise.all(Array.from({ length: 30 }, () => t.makeLead()));
    const rs = await Promise.all(leads.map((l) => svc.assignLeadToProperty(p.id, l)));
    for (const e of es) assert.equal(rs.filter((r) => r?.executiveId === e.id).length, 10);
  });

  it('a custom AvailabilityService decides who is available', async () => {
    const a = await t.exec('cu.a');
    const b = await t.exec('cu.b');
    const p = await newProperty([a.id, b.id]);
    const onlyB: AvailabilityService = { getAvailableExecutiveIds: async (ids) => new Set(ids.filter((i) => i === b.id)) };
    const custom = new PropertyAssignmentService(onlyB);
    for (let i = 0; i < 3; i++) assert.equal((await custom.assignLeadToProperty(p.id, await t.makeLead()))?.executiveId, b.id);
  });
});
