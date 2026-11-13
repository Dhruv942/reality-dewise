import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, ZERO } from './helpers';

let t: Awaited<ReturnType<typeof startTestApp>>;
let mgr: { id: string };
let exec: { id: string };
let otherExec: { id: string };
let adminCall: ReturnType<typeof t.asToken>;
let mgrCall: ReturnType<typeof t.asToken>;
let execCall: ReturnType<typeof t.asToken>;
let otherCall: ReturnType<typeof t.asToken>;

const note = (title: string, content?: string) => ({ title, ...(content !== undefined ? { content } : {}) });

before(async () => {
  t = await startTestApp();
  mgr = await t.manager('notes.mgr');
  exec = await t.exec('notes.exec', mgr.id);
  otherExec = await t.exec('notes.other');
  adminCall = t.asToken(await t.login('admin', 'admin@test.com', 'Admin-pass-123'));
  mgrCall = t.asToken(await t.login('manager', 'notes.mgr@test.com', 'TempPass123'));
  execCall = t.asToken(await t.login('executive', 'notes.exec@test.com', 'TempPass123'));
  otherCall = t.asToken(await t.login('executive', 'notes.other@test.com', 'TempPass123'));
});
after(() => t.close());

describe('personal notes', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await fetch(t.base + '/api/v1/notes');
    assert.equal(res.status, 401);
  });

  it('rejects invalid payloads and ids', async () => {
    assert.equal((await adminCall('/notes', 'POST', { title: '' })).status, 400);
    assert.equal((await adminCall('/notes', 'POST', { title: 'x', extra: true })).status, 400);
    assert.equal((await adminCall('/notes', 'POST', { title: 'x', userId: ZERO })).status, 400);
    assert.equal((await adminCall(`/notes/${ZERO.slice(0, 8)}`)).status, 400);
    assert.equal((await adminCall(`/notes/${ZERO}`)).status, 404);
  });

  it('ADMIN, MANAGER and SALES each CRUD only their own notes', async () => {
    const roles = [
      { name: 'ADMIN', call: adminCall },
      { name: 'MANAGER', call: mgrCall },
      { name: 'SALES', call: execCall },
    ];
    for (const { name, call } of roles) {
      const created = await call('/notes', 'POST', note(`${name} title`, `${name} body`));
      assert.equal(created.status, 201, name);
      assert.equal(created.body.title, `${name} title`);
      assert.equal(created.body.content, `${name} body`);
      assert.ok(created.body.id);
      assert.ok(created.body.createdAt);
      assert.ok(created.body.updatedAt);
      assert.equal(created.body.userId, undefined);

      const id = created.body.id as string;
      const got = await call(`/notes/${id}`);
      assert.equal(got.status, 200, name);
      assert.equal(got.body.title, `${name} title`);

      const patched = await call(`/notes/${id}`, 'PATCH', { title: `${name} updated`, content: `${name} new` });
      assert.equal(patched.status, 200, name);
      assert.equal(patched.body.title, `${name} updated`);
      assert.equal(patched.body.content, `${name} new`);
      assert.ok(new Date(patched.body.updatedAt) >= new Date(patched.body.createdAt));

      const listed = await call('/notes');
      assert.equal(listed.status, 200, name);
      assert.equal(listed.body.some((n: { id: string }) => n.id === id), true, name);

      const del = await call(`/notes/${id}`, 'DELETE');
      assert.equal(del.status, 200, name);
      assert.equal((await call(`/notes/${id}`)).status, 404, name);
    }
  });

  it('does not let one user read, update, delete, or list another user\'s notes', async () => {
    const mine = (await execCall('/notes', 'POST', note('private', 'secret'))).body;
    const otherList = await otherCall('/notes');
    assert.equal(otherList.body.some((n: { id: string }) => n.id === mine.id), false);
    assert.equal((await otherCall(`/notes/${mine.id}`)).status, 404);
    assert.equal((await otherCall(`/notes/${mine.id}`, 'PATCH', { title: 'stolen' })).status, 404);
    assert.equal((await otherCall(`/notes/${mine.id}`, 'DELETE')).status, 404);
    assert.equal((await mgrCall(`/notes/${mine.id}`)).status, 404);
    assert.equal((await adminCall(`/notes/${mine.id}`)).status, 404);
    assert.equal((await execCall(`/notes/${mine.id}`)).status, 200);
  });

  it('search matches title or content, escapes LIKE wildcards, and sorts by most recently updated', async () => {
    const older = await execCall('/notes', 'POST', note('Alpha site visit', 'call tomorrow'));
    await new Promise((r) => setTimeout(r, 20));
    const newer = await execCall('/notes', 'POST', note('Beta', 'follow up on Alpha'));
    assert.equal(older.status, 201);
    const list = (await execCall('/notes')).body;
    const ids = list.map((n: { id: string }) => n.id);
    assert.ok(ids.indexOf(newer.body.id) < ids.indexOf(older.body.id));

    const bumped = await execCall(`/notes/${older.body.id}`, 'PATCH', { content: 'rescheduled' });
    assert.equal(bumped.status, 200);
    const resorted = (await execCall('/notes')).body.map((n: { id: string }) => n.id);
    assert.ok(resorted.indexOf(older.body.id) < resorted.indexOf(newer.body.id));

    const byTitle = (await execCall('/notes?search=site')).body;
    assert.equal(byTitle.some((n: { id: string }) => n.id === older.body.id), true);
    const byContent = (await execCall('/notes?search=follow%20up')).body;
    assert.equal(byContent.some((n: { id: string }) => n.id === newer.body.id), true);
    assert.equal((await execCall('/notes?search=%25')).body.length, 0);
    assert.equal((await execCall('/notes?search=zzz-no-match')).body.length, 0);
  });

  it('paginates with limit and offset', async () => {
    const a = (await otherCall('/notes', 'POST', note('p1', 'a'))).body.id;
    const b = (await otherCall('/notes', 'POST', note('p2', 'b'))).body.id;
    const c = (await otherCall('/notes', 'POST', note('p3', 'c'))).body.id;
    const page = await otherCall('/notes?limit=2&offset=0');
    assert.equal(page.status, 200);
    assert.equal(page.body.length, 2);
    const next = await otherCall('/notes?limit=2&offset=2');
    assert.equal(next.body.length, 1);
    const all = [...page.body, ...next.body].map((n: { id: string }) => n.id);
    assert.deepEqual(new Set(all), new Set([a, b, c]));
  });

  it('view-as dashboards do not expose personal notes', async () => {
    const execNote = (await execCall('/notes', 'POST', note('exec only', 'hidden'))).body;
    const dash = await adminCall(`/view/executives/${exec.id}/dashboard`);
    assert.equal(dash.status, 200);
    assert.equal(dash.body.notes, undefined);
    const json = JSON.stringify(dash.body);
    assert.equal(json.includes(execNote.id), false);
    const adminList = (await adminCall('/notes')).body;
    assert.equal(adminList.some((n: { id: string }) => n.id === execNote.id), false);
  });
});
