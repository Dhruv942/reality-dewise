import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
before(async () => { t = await startTestApp(); });
after(() => t.close());

describe('projects', () => {
  it('allows Admin to create, list, inspect, update and archive a project', async () => {
    const created = await t.call('/admin/projects', 'POST', { name: 'Rustomjee Elita', location: 'Thane' });
    assert.equal(created.status, 201);
    assert.match(created.body.projectCode, /^PRJ-\d{4}-\d{6}$/);
    assert.equal(created.body.status, 'ACTIVE');

    assert.equal((await t.call('/admin/projects?search=Elita')).body.length, 1);
    assert.equal((await t.call(`/admin/projects/${created.body.id}`)).body.name, 'Rustomjee Elita');
    assert.equal((await t.call(`/admin/projects/${created.body.id}`, 'PATCH', { description: 'Residential project' })).body.description, 'Residential project');
    assert.equal((await t.call(`/admin/projects/${created.body.id}/archive`, 'POST')).body.status, 'ARCHIVED');
  });

  it('rejects invalid input and non-admin access', async () => {
    assert.equal((await t.call('/admin/projects', 'POST', { name: '' })).status, 400);
    const exec = await t.exec('project.exec');
    const token = await t.login('executive', 'project.exec@test.com', 'TempPass123');
    assert.equal((await t.asToken(token)('/admin/projects')).status, 403);
    assert.equal((await t.asToken(token)('/admin/projects', 'POST', { name: 'Nope' })).status, 403);
    assert.equal((await t.call('/admin/projects/00000000-0000-0000-0000-000000000000')).status, 404);
    assert.ok(exec.id);
  });
});
