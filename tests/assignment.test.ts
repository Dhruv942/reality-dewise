import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/database/pool';
import { PropertyAssignmentService, propertyAssignmentService as svc } from '../src/modules/assignment/assignment.service';
import type { AvailabilityService } from '../src/modules/assignment/availability.service';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let n = 0;
const assign = async (propertyId: string) => svc.assignLeadToProperty(propertyId, await t.makeLead());
const who = async (propertyId: string) => (await assign(propertyId)).executiveId;
const newProperty = (extra: object) =>
  t.property({ externalPropertyId: `P${++n}`, source: '99ACRES', name: `Property ${n}`, ...extra });
const rotation = async (propertyId: string, times: number) => {
  const out: string[] = [];
  for (let i = 0; i < times; i++) out.push(await who(propertyId));
  return out;
};

before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('spec scenario: primary Amit, fallback round robin, Amit returns', () => {
  it('Lead1 Amit -> Amit off -> Lead2 Rahul, Lead3 Priya -> Amit on -> Lead4 Amit; primary never changes', async () => {
    const team = await t.team('Team A');
    const amit = await t.exec('amit', team.id);
    const rahul = await t.exec('rahul', team.id);
    const priya = await t.exec('priya', team.id);
    const p = await t.property({ externalPropertyId: 'MB12345', source: '99ACRES', name: 'XYZ Residency', teamId: team.id, primaryExecutiveId: amit.id });

    const l1 = await assign(p.id);
    assert.equal(l1.executiveId, amit.id);
    assert.equal(l1.assignmentType, 'PRIMARY');
    assert.equal(l1.reason, 'PRIMARY_EXECUTIVE_AVAILABLE');
    assert.equal((await assign(p.id)).executiveId, amit.id, 'lead 1b still Amit');

    await t.setActive(amit.id, false);
    const l2 = await assign(p.id);
    assert.equal(l2.executiveId, rahul.id);
    assert.equal(l2.assignmentType, 'ROUND_ROBIN');
    assert.equal(l2.reason, 'PRIMARY_EXECUTIVE_UNAVAILABLE');
    const l3 = await assign(p.id);
    assert.equal(l3.executiveId, priya.id);
    assert.equal((await t.call(`/admin/properties/${p.id}`)).body.primaryExecutive.id, amit.id, 'primary unchanged during fallback');
    assert.equal((await who(p.id)), rahul.id, 'Amit must not be in the fallback pool: Rahul, Priya, Rahul...');

    await t.setActive(amit.id, true);
    const l4 = await assign(p.id);
    assert.equal(l4.executiveId, amit.id);
    assert.equal(l4.assignmentType, 'PRIMARY');
    assert.equal((await t.call(`/admin/properties/${p.id}`)).body.primaryExecutive.id, amit.id);

    // history: newest first, with type/reason/lead
    const h = await t.call(`/admin/properties/${p.id}/assignment-history`);
    assert.equal(h.status, 200);
    assert.equal(h.body.history.length, 6);
    assert.equal(h.body.history[0].leadId, l4.leadId);
    assert.equal(h.body.history[0].executive.name, 'Amit');
    const l2h = h.body.history.find((x: any) => x.leadId === l2.leadId);
    assert.equal(l2h.executive.name, 'Rahul');
    assert.equal(l2h.assignmentType, 'ROUND_ROBIN');
    assert.equal(l2h.reason, 'PRIMARY_EXECUTIVE_UNAVAILABLE');
    assert.equal((await t.call(`/admin/properties/${p.id}/assignment-history?limit=2&offset=1`)).body.history.length, 2);
    assert.equal((await t.call(`/admin/properties/${p.id}/assignment-history?limit=0`)).status, 400);
    assert.equal((await t.call(`/admin/properties/${ZERO}/assignment-history`)).status, 404);
  });
});

describe('round robin', () => {
  it('rotates evenly and wraps: Rahul, Priya, Neha, Rahul...', async () => {
    const team = await t.team('RR Team');
    const amit = await t.exec('rr.amit', team.id);
    const [rahul, priya, neha] = [await t.exec('rr.rahul', team.id), await t.exec('rr.priya', team.id), await t.exec('rr.neha', team.id)];
    const p = await newProperty({ teamId: team.id, primaryExecutiveId: amit.id });
    await t.setActive(amit.id, false);
    assert.deepEqual(await rotation(p.id, 7), [rahul.id, priya.id, neha.id, rahul.id, priya.id, neha.id, rahul.id]);
  });

  it('no primary executive -> round robin over the whole team, reason NO_PRIMARY_EXECUTIVE', async () => {
    const team = await t.team('NoPrimary');
    const [a, b, c] = [await t.exec('np.a', team.id), await t.exec('np.b', team.id), await t.exec('np.c', team.id)];
    const p = await newProperty({ teamId: team.id });
    const r = await assign(p.id);
    assert.equal(r.reason, 'NO_PRIMARY_EXECUTIVE');
    assert.equal(r.assignmentType, 'ROUND_ROBIN');
    assert.deepEqual([r.executiveId, ...(await rotation(p.id, 3))], [a.id, b.id, c.id, a.id]);
  });

  it('inactive executives are excluded from the pool', async () => {
    const team = await t.team('Excl');
    const amit = await t.exec('ex.amit', team.id);
    const rahul = await t.exec('ex.rahul', team.id);
    const priya = await t.exec('ex.priya', team.id);
    const neha = await t.exec('ex.neha', team.id);
    const p = await newProperty({ teamId: team.id, primaryExecutiveId: amit.id });
    await t.setActive(amit.id, false);
    await t.setActive(priya.id, false);
    assert.deepEqual(await rotation(p.id, 4), [rahul.id, neha.id, rahul.id, neha.id]);
  });

  it('pointer is persistent and survives the last-assigned executive being deactivated', async () => {
    const team = await t.team('Persist');
    const [a, b, c] = [await t.exec('ps.a', team.id), await t.exec('ps.b', team.id), await t.exec('ps.c', team.id)];
    const p = await newProperty({ teamId: team.id });
    assert.equal(await who(p.id), a.id);
    assert.equal(await who(p.id), b.id);
    await t.setActive(b.id, false); // last assigned goes away
    assert.equal(await who(p.id), c.id, 'continues after b, does not restart at a');
    await t.setActive(b.id, true);
    assert.equal(await who(p.id), a.id);
    const { rows } = await pool.query('SELECT last_assigned_executive_id FROM team_assignment_state WHERE team_id=$1', [team.id]);
    assert.equal(rows[0].last_assigned_executive_id, a.id);
  });

  it('a newly added executive joins the rotation', async () => {
    const team = await t.team('Grow');
    const [a, b] = [await t.exec('gr.a', team.id), await t.exec('gr.b', team.id)];
    const p = await newProperty({ teamId: team.id });
    assert.deepEqual(await rotation(p.id, 2), [a.id, b.id]);
    const c = await t.exec('gr.c', team.id);
    assert.deepEqual(await rotation(p.id, 3), [c.id, a.id, b.id]);
  });

  it('rotation is shared per team across its properties', async () => {
    const team = await t.team('Shared');
    const [a, b] = [await t.exec('sh.a', team.id), await t.exec('sh.b', team.id)];
    const p1 = await newProperty({ teamId: team.id });
    const p2 = await newProperty({ teamId: team.id });
    assert.deepEqual([await who(p1.id), await who(p2.id), await who(p1.id)], [a.id, b.id, a.id]);
  });
});

describe('rejections', () => {
  it('inactive property, unknown property, no team, inactive team, empty pool', async () => {
    const team = await t.team('Rej');
    const a = await t.exec('rej.a', team.id);

    const inactive = await newProperty({ teamId: team.id, primaryExecutiveId: a.id, isActive: false });
    await assert.rejects(assign(inactive.id), /Property is inactive/);
    await assert.rejects(assign(ZERO), /Property not found/);

    const noTeam = await newProperty({});
    await assert.rejects(assign(noTeam.id), /no team configured/);

    const p = await newProperty({ teamId: team.id, primaryExecutiveId: a.id });
    await t.call(`/admin/teams/${team.id}/status`, 'PATCH', { isActive: false });
    await assert.rejects(assign(p.id), /team is inactive/);
    await t.call(`/admin/teams/${team.id}/status`, 'PATCH', { isActive: true });

    await t.setActive(a.id, false);
    await assert.rejects(assign(p.id), /No available executive/);
    const { rows } = await pool.query('SELECT count(*)::int n FROM property_assignment_history WHERE property_id = $1', [p.id]);
    assert.equal(rows[0].n, 0, 'failed assignments record nothing');

    await t.setActive(a.id, true);
    assert.equal(await who(p.id), a.id, 'recovers once someone is available');
  });
});

describe('idempotency', () => {
  it('re-assigning the same lead returns the original result without rotating', async () => {
    const team = await t.team('Idem');
    const [a, b] = [await t.exec('id.a', team.id), await t.exec('id.b', team.id)];
    const p = await newProperty({ teamId: team.id });
    const lead = await t.makeLead();
    const first = await svc.assignLeadToProperty(p.id, lead);
    const again = await svc.assignLeadToProperty(p.id, lead);
    assert.equal(first.executiveId, a.id);
    assert.equal(again.executiveId, a.id);
    assert.equal(again.alreadyAssigned, true);
    assert.equal(first.alreadyAssigned, false);
    assert.equal(await who(p.id), b.id, 'next new lead is the next executive');
    const other = await newProperty({ teamId: team.id });
    await assert.rejects(svc.assignLeadToProperty(other.id, lead), /different property/);
  });
});

describe('pluggable availability', () => {
  it('a custom AvailabilityService changes who is eligible without touching assignment logic', async () => {
    const team = await t.team('Custom');
    const [a, b, c] = [await t.exec('cu.a', team.id), await t.exec('cu.b', team.id), await t.exec('cu.c', team.id)];
    const p = await newProperty({ teamId: team.id, primaryExecutiveId: a.id });
    const onLeave = new Set([a.id, b.id]); // e.g. leave management, though all are is_active
    const custom: AvailabilityService = {
      async getAvailableExecutiveIds(ids) { return new Set(ids.filter((i) => !onLeave.has(i))); },
    };
    const s = new PropertyAssignmentService(custom);
    const r = await s.assignLeadToProperty(p.id, await t.makeLead());
    assert.equal(r.executiveId, c.id);
    assert.equal(r.reason, 'PRIMARY_EXECUTIVE_UNAVAILABLE');
  });
});

describe('concurrency', () => {
  it('parallel leads get a perfectly even rotation with no duplicates or lost updates', async () => {
    const team = await t.team('Conc');
    const execs = [await t.exec('co.a', team.id), await t.exec('co.b', team.id), await t.exec('co.c', team.id)];
    const p = await newProperty({ teamId: team.id });
    const N = 30;
    const results = await Promise.all(Array.from({ length: N }, () => assign(p.id)));

    const counts = new Map<string, number>();
    for (const r of results) counts.set(r.executiveId, (counts.get(r.executiveId) ?? 0) + 1);
    assert.deepEqual(execs.map((e) => counts.get(e.id)), [10, 10, 10]);

    const { rows } = await pool.query('SELECT 1 FROM property_assignment_history WHERE property_id = $1', [p.id]);
    assert.equal(rows.length, N);
    const order = execs.map((e) => e.id);
    const { rows: st } = await pool.query('SELECT last_assigned_executive_id FROM team_assignment_state WHERE team_id=$1', [team.id]);
    assert.equal(st[0].last_assigned_executive_id, order[(N - 1) % 3], 'pointer advanced exactly N times');
    assert.equal(new Set(results.map((r) => r.historyId)).size, N);
  });

  it('parallel leads across primary/fallback keep working while availability flips', async () => {
    const team = await t.team('Conc2');
    const amit = await t.exec('c2.amit', team.id);
    const [b, c] = [await t.exec('c2.b', team.id), await t.exec('c2.c', team.id)];
    const p = await newProperty({ teamId: team.id, primaryExecutiveId: amit.id });
    const first = await Promise.all(Array.from({ length: 8 }, () => assign(p.id)));
    assert.ok(first.every((r) => r.executiveId === amit.id && r.assignmentType === 'PRIMARY'));
    await t.setActive(amit.id, false);
    const second = await Promise.all(Array.from({ length: 8 }, () => assign(p.id)));
    assert.ok(second.every((r) => r.assignmentType === 'ROUND_ROBIN' && r.executiveId !== amit.id));
    assert.equal(second.filter((r) => r.executiveId === b.id).length, 4);
    assert.equal(second.filter((r) => r.executiveId === c.id).length, 4);
  });

  it('the same lead delivered many times in parallel is assigned exactly once', async () => {
    const team = await t.team('Conc3');
    const [a] = [await t.exec('c3.a', team.id), await t.exec('c3.b', team.id), await t.exec('c3.c', team.id)];
    const p = await newProperty({ teamId: team.id });
    const lead = await t.makeLead();
    const rs = await Promise.all(Array.from({ length: 8 }, () => svc.assignLeadToProperty(p.id, lead)));
    assert.equal(new Set(rs.map((r) => r.executiveId)).size, 1);
    assert.equal(new Set(rs.map((r) => r.historyId)).size, 1);
    assert.equal(rs.filter((r) => !r.alreadyAssigned).length, 1);
    const { rows } = await pool.query('SELECT count(*)::int n FROM property_assignment_history WHERE lead_id=$1', [lead]);
    assert.equal(rows[0].n, 1);
    assert.equal(await who(p.id), (await t.call('/admin/executives?search=c3.b')).body[0].id, 'pointer advanced once, not eight times');
    void a;
  });
});
