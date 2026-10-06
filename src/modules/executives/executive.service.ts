import { AppError, NotFoundError } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import { assertTeamAssignable } from '../teams/team.service';
import * as teamRepo from '../teams/team.repository';
import { toTeamDto } from '../teams/team.model';
import type { UserDesignation } from '../users/user.model';
import * as repo from './executive.repository';
import { toExecutiveDto, type ExecutiveRow } from './executive.model';

type ManagedRole = 'SALES' | 'MANAGER';

/**
 * One implementation of "admin manages user accounts" for both account types, so sales users and managers
 * share the same rules (unique email/username, soft delete, password change, activate/deactivate).
 *   SALES   : sales executives and executive managers (designation differs, permissions do not); can join a team.
 *   MANAGER : leads teams (a team points at its manager); is never a team member.
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

  /** Assignment rules: executive active + team exists + team active. */
  async function assertCanJoinTeam(exec: ExecutiveRow, teamId: string): Promise<void> {
    if (!exec.is_active) throw new AppError(409, 'Executive is inactive');
    await assertTeamAssignable(teamId);
  }

  const list = async (f: { teamId?: string; isActive?: boolean; search?: string; managerId?: string }) =>
    (await repo.list({ ...f, role })).map(toExecutiveDto);

  /** A manager's detail also lists the teams they lead. */
  async function details(id: string) {
    const dto = toExecutiveDto(await getUser(id));
    if (role !== 'MANAGER') return dto;
    const teams = await teamRepo.list({ managerId: id });
    return { ...dto, managedTeams: teams.map(toTeamDto) };
  }

  async function create(input: {
    name: string;
    email: string;
    phone?: string | null;
    username: string;
    password: string;
    designation?: UserDesignation;
    teamId?: string | null;
  }) {
    if (input.teamId) await assertTeamAssignable(input.teamId);
    const id = await repo.insert({
      role,
      designation: role === 'MANAGER' ? 'MANAGER' : (input.designation ?? 'SALES_EXECUTIVE'),
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      username: input.username,
      passwordHash: await hashPassword(input.password),
      teamId: input.teamId ?? null,
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
      teamId?: string | null;
    },
  ) {
    const exec = await getUser(id);
    const { teamId, ...profile } = input;
    if (teamId && teamId !== exec.team_id) await assertCanJoinTeam(exec, teamId);
    await repo.updateProfile(id, { ...profile, team_id: teamId });
    return reload(id);
  }

  async function changePassword(id: string, password: string): Promise<void> {
    await getUser(id);
    await repo.setPasswordHash(id, await hashPassword(password));
  }

  async function setStatus(id: string, isActive: boolean) {
    await getUser(id);
    await repo.setActive(id, isActive);
    return reload(id);
  }

  async function remove(id: string) {
    await getUser(id);
    await repo.softDelete(id);
    if (role === 'MANAGER') await repo.clearManagerFromTeams(id);
    const row = await repo.findById(id);
    return toExecutiveDto(row!);
  }

  async function assignTeam(id: string, teamId: string) {
    const exec = await getUser(id);
    await assertCanJoinTeam(exec, teamId);
    await repo.setTeam(id, teamId);
    return reload(id);
  }

  async function removeFromTeam(id: string) {
    await getUser(id);
    await repo.setTeam(id, null);
    return reload(id);
  }

  return { list, details, create, update, changePassword, setStatus, remove, assignTeam, removeFromTeam };
}

export const executiveService = createUserService('SALES');
export const managerService = createUserService('MANAGER');
