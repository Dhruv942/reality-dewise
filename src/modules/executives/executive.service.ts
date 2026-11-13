import { AppError, NotFoundError } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import { disconnectUser } from '../../realtime/socket';
import { revokeUserDevices } from '../push/push.service';
import type { UserDesignation } from '../users/user.model';
import * as repo from './executive.repository';
import { toExecutiveDto, type ExecutiveRow } from './executive.model';

type ManagedRole = 'SALES' | 'MANAGER';

/**
 * One implementation of "admin manages user accounts" for both account types, so sales users and managers
 * share the same rules (unique email/username, soft delete, password change, activate/deactivate).
 *   SALES   : sales executives and executive managers (designation differs, permissions do not); each can report to one manager.
 *   MANAGER : looks after the sales users that point at them (users.manager_id); never has a manager themselves.
 */
function createUserService(role: ManagedRole) {
  const label = role === 'MANAGER' ? 'Manager' : 'Executive';

  /** 404 if missing or soft-deleted, 400 if the user exists but has another role. */
  async function getUser(id: string): Promise<ExecutiveRow> {
    const row = await repo.findById(id);
    if (!row || row.deleted_at) throw new NotFoundError(`${label} not found`);
    if (row.role !== role) throw new AppError(400, `User is not a${role === 'MANAGER' ? ' manager' : 'n executive'}`);
    return row;
  }

  const reload = async (id: string) => toExecutiveDto(await getUser(id));

  /** The manager must be a live, active MANAGER account. */
  async function assertValidManager(managerId: string): Promise<void> {
    const m = await repo.findById(managerId);
    if (!m || m.deleted_at) throw new AppError(400, 'Manager not found');
    if (m.role !== 'MANAGER') throw new AppError(400, 'User is not a manager');
    if (!m.is_active) throw new AppError(409, 'Manager is inactive');
  }

  const list = async (f: { isActive?: boolean; search?: string; managerId?: string }) =>
    (await repo.list({ ...f, role })).map(toExecutiveDto);

  /** A manager's detail also lists the sales users that report to them. */
  async function details(id: string) {
    const dto = toExecutiveDto(await getUser(id));
    if (role !== 'MANAGER') return dto;
    return { ...dto, executives: (await repo.list({ managerId: id })).map(toExecutiveDto) };
  }

  async function create(input: {
    name: string;
    email: string;
    phone?: string | null;
    username: string;
    password: string;
    designation?: UserDesignation;
    managerId?: string | null;
  }) {
    if (input.managerId) await assertValidManager(input.managerId);
    const id = await repo.insert({
      role,
      designation: role === 'MANAGER' ? 'MANAGER' : (input.designation ?? 'SALES_EXECUTIVE'),
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      managerId: input.managerId ?? null,
    });
    return reload(id);
  }

  async function update(
    id: string,
    input: {
      name?: string;
      email?: string;
      phone?: string | null;
      username?: string;
      designation?: UserDesignation;
      managerId?: string | null;
    },
  ) {
    const exec = await getUser(id);
    const { managerId, ...profile } = input;
    if (managerId && managerId !== exec.manager_id) await assertCanReport(exec, managerId);
    await repo.updateProfile(id, { ...profile, manager_id: managerId });
    return reload(id);
  }

  async function changePassword(id: string, password: string): Promise<void> {
    await getUser(id);
    await repo.setPasswordHash(id, await hashPassword(password));
    disconnectUser(id); // the old sessions are over: close their live sockets and stop waking their devices
    await revokeUserDevices(id);
  }

  async function setStatus(id: string, isActive: boolean) {
    await getUser(id);
    await repo.setActive(id, isActive);
    if (!isActive) {
      disconnectUser(id);
      await revokeUserDevices(id);
    }
    return reload(id);
  }

  async function remove(id: string) {
    await getUser(id);
    await repo.softDelete(id);
    disconnectUser(id);
    await revokeUserDevices(id);
    if (role === 'MANAGER') await repo.clearManagerFrom(id);
    const row = await repo.findById(id);
    return toExecutiveDto(row!);
  }

  /** Only sales users have a manager, and they must be active themselves. */
  async function assertCanReport(exec: ExecutiveRow, managerId: string): Promise<void> {
    if (exec.role !== 'SALES') throw new AppError(400, 'Only sales executives can have a manager');
    if (!exec.is_active) throw new AppError(409, 'Executive is inactive');
    await assertValidManager(managerId);
  }

  async function assignManager(id: string, managerId: string) {
    await assertCanReport(await getUser(id), managerId);
    await repo.setManager(id, managerId);
    return reload(id);
  }

  async function removeManager(id: string) {
    await getUser(id);
    await repo.setManager(id, null);
    return reload(id);
  }

  return { list, details, create, update, changePassword, setStatus, remove, assignManager, removeManager };
}

export const executiveService = createUserService('SALES');
export const managerService = createUserService('MANAGER');
