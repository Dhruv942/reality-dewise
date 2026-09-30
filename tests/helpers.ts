import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { randomInt } from 'node:crypto';
import { createApp } from '../src/app';
import { pool } from '../src/database/pool';
import { hashPassword } from '../src/utils/password';
import { upsertByEmail } from '../src/modules/users/user.repository';

export const ZERO = '00000000-0000-0000-0000-000000000000';

export async function startTestApp() {
  await pool.query('TRUNCATE users, teams, customers CASCADE');
  await upsertByEmail({ name: 'Admin', email: 'admin@test.com', username: 'admin', passwordHash: await hashPassword('Admin-pass-123'), role: 'ADMIN' });
  const server: Server = createApp().listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const raw = async (path: string, method: string, body: unknown, token: string) => {
    const res = await fetch(base + '/api/v1' + path, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const token = (await raw('/auth/admin/login', 'POST', { email: 'admin@test.com', password: 'Admin-pass-123' }, '')).body.accessToken as string;
  const call = (path: string, method = 'GET', body?: unknown) => raw(path, method, body, token);

  const team = async (name: string) => (await call('/admin/teams', 'POST', { name })).body;
  const exec = async (username: string, teamId?: string) =>
    (await call('/admin/executives', 'POST', { name: username[0].toUpperCase() + username.slice(1), email: `${username}@test.com`, username, password: 'TempPass123', teamId })).body;
  const setActive = (id: string, isActive: boolean) => call(`/admin/executives/${id}/status`, 'PATCH', { isActive });
  const property = async (body: object) => (await call('/admin/properties', 'POST', body)).body;

  // Raw lead row (no assignment) so tests can drive the assignment service directly. Needs >=1 property.
  const makeLead = async (): Promise<string> => {
    const c = await pool.query<{ id: string }>('INSERT INTO customers (name, mobile) VALUES ($1, $2) RETURNING id', [
      'Test Customer',
      `+91${randomInt(1_000_000_000, 9_999_999_999)}`,
    ]);
    const l = await pool.query<{ id: string }>(
      'INSERT INTO leads (customer_id, property_id, source) SELECT $1, id, source FROM properties LIMIT 1 RETURNING id',
      [c.rows[0].id],
    );
    return l.rows[0].id;
  };

  const login = async (portal: 'admin' | 'executive', email: string, password: string) =>
    (await raw(`/auth/${portal}/login`, 'POST', { email, password }, '')).body.accessToken as string;
  const asToken = (tok: string) => (path: string, method = 'GET', body?: unknown) => raw(path, method, body, tok);

  return { makeLead, login, asToken, call, team, exec, setActive, property, close: async () => { server.close(); await pool.end(); } };
}
