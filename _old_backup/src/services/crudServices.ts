// Thin services for plain setup/master data. They exist so controllers never touch the DB directly.
import { pool, insertRow, softDeleteRow, updateRow } from '../db/pool';
import type { Customer, Project, Property, Team, User } from '../models/types';
import { customerRepository } from '../repositories/customerRepository';
import { leadRepository } from '../repositories/leadRepository';
import { notificationRepository } from '../repositories/notificationRepository';
import { projectRepository } from '../repositories/projectRepository';
import { propertyRepository } from '../repositories/propertyRepository';
import { teamRepository } from '../repositories/teamRepository';
import { userRepository } from '../repositories/userRepository';
import { BusinessRuleError, NotFoundError } from '../utils/errors';
import { normalizeMobile } from '../utils/mobile';
import { Pagination, toPage } from '../utils/pagination';

const found = <T>(row: T | null, entity: string): T => { if (!row) throw new NotFoundError(entity); return row; };

async function assertTeam(id?: number | null) { if (id && !(await teamRepository.findById(pool, id))) throw new BusinessRuleError('Team not found'); }
async function assertProject(id?: number | null) { if (id && !(await projectRepository.findById(pool, id))) throw new BusinessRuleError('Project not found'); }

export const teamService = {
  create: (d: { name: string; isActive?: boolean }) => insertRow<Team>(pool, 'teams', d),
  list: () => teamRepository.list(pool),
  async get(id: number) { const team = found(await teamRepository.findById(pool, id), 'Team'); return { ...team, members: await teamRepository.members(pool, id), projects: await projectRepository.list(pool, { teamId: id }) }; },
  async update(id: number, d: { name?: string; isActive?: boolean }) { return found(await updateRow<Team>(pool, 'teams', id, d), 'Team'); },
  async remove(id: number) { if (!(await softDeleteRow(pool, 'teams', id))) throw new NotFoundError('Team'); },
};

export const userService = {
  async create(d: { name: string; mobile?: string; email?: string; isActive?: boolean; teamId?: number }) {
    await assertTeam(d.teamId);
    return insertRow<User>(pool, 'users', d);
  },
  list: (f: { teamId?: number; isActive?: boolean }) => userRepository.list(pool, f),
  async get(id: number) { return found(await userRepository.findById(pool, id), 'User'); },
  async update(id: number, d: { name?: string; mobile?: string; email?: string; isActive?: boolean; teamId?: number | null }) {
    await assertTeam(d.teamId);
    return found(await updateRow<User>(pool, 'users', id, d), 'User');
  },
  async remove(id: number) { if (!(await softDeleteRow(pool, 'users', id))) throw new NotFoundError('User'); },
};

export const projectService = {
  async create(d: { name: string; location?: string; status?: string; teamId?: number; slaMinutes?: number }) {
    await assertTeam(d.teamId);
    return insertRow<Project>(pool, 'projects', d);
  },
  list: (f: { status?: string; teamId?: number }) => projectRepository.list(pool, f),
  async get(id: number) { return found(await projectRepository.findById(pool, id), 'Project'); },
  async update(id: number, d: { name?: string; location?: string; status?: string; teamId?: number | null; slaMinutes?: number | null }) {
    await assertTeam(d.teamId);
    return found(await updateRow<Project>(pool, 'projects', id, d), 'Project');
  },
  async remove(id: number) { if (!(await softDeleteRow(pool, 'projects', id))) throw new NotFoundError('Project'); },
};

export const propertyService = {
  async create(d: { projectId: number; unitNumber: string; propertyType?: string; bhk?: number; price: number; areaSqft?: number; availability?: string; metadata?: Record<string, unknown> }) {
    await assertProject(d.projectId);
    return insertRow<Property>(pool, 'properties', { ...d, metadata: d.metadata ? JSON.stringify(d.metadata) : undefined });
  },
  list: (f: { projectId?: number; bhk?: number; availability?: string; maxPrice?: number }) => propertyRepository.list(pool, f),
  async get(id: number) { return found(await propertyRepository.findById(pool, id), 'Property'); },
  async update(id: number, d: { unitNumber?: string; propertyType?: string; bhk?: number | null; price?: number; areaSqft?: number | null; availability?: string; metadata?: Record<string, unknown> }) {
    return found(await updateRow<Property>(pool, 'properties', id, { ...d, metadata: d.metadata ? JSON.stringify(d.metadata) : undefined }), 'Property');
  },
  async remove(id: number) { if (!(await softDeleteRow(pool, 'properties', id))) throw new NotFoundError('Property'); },
};

export const customerService = {
  async list(p: Pagination, search?: string) { return toPage(await customerRepository.list(pool, p, search), p); },
  async get(id: number) {
    const customer = found(await customerRepository.findById(pool, id), 'Customer');
    return { ...customer, leads: await leadRepository.previousLeads(pool, id), enquiries: await leadRepository.previousEnquiries(pool, customer.mobile) };
  },
  async update(id: number, d: { name?: string; email?: string }) { return found(await updateRow<Customer>(pool, 'customers', id, d), 'Customer'); },
  normalizeMobile,
};

export const notificationService = {
  async list(f: { userId?: number; unread?: boolean }, p: Pagination) { return toPage(await notificationRepository.list(pool, f, p), p); },
  async markRead(id: number) { return found(await notificationRepository.markRead(pool, id), 'Notification'); },
};
