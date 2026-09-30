import { AppError, NotFoundError } from '../../utils/errors';
import { hashPassword } from '../../utils/password';
import { assertTeamAssignable } from '../teams/team.service';
import { countPrimaryFor } from '../properties/property.repository';
import * as repo from './executive.repository';
import { toExecutiveDto, type ExecutiveRow } from './executive.model';

/** 404 if missing or soft-deleted, 400 if the user exists but is not an EXECUTIVE. */
async function getExecutive(id: string): Promise<ExecutiveRow> {
  const row = await repo.findById(id);
  if (!row || row.deleted_at) throw new NotFoundError('Executive not found');
  if (row.role !== 'EXECUTIVE') throw new AppError(400, 'User is not an executive');
  return row;
}

const reload = async (id: string) => toExecutiveDto(await getExecutive(id));

/** Assignment rules: executive active + team exists + team active. */
async function assertCanJoinTeam(exec: ExecutiveRow, teamId: string): Promise<void> {
  if (!exec.is_active) throw new AppError(409, 'Executive is inactive');
  await assertTeamAssignable(teamId);
}

/**
 * An executive who is the primary executive of a property must stay in that property's team
 * (also enforced by a composite FK). Refuse the move with a clear message instead of a raw DB error.
 */
async function assertCanLeaveTeam(exec: ExecutiveRow, newTeamId: string | null): Promise<void> {
  if (exec.team_id === newTeamId) return;
  const n = await countPrimaryFor(exec.id);
  if (n > 0) {
    throw new AppError(409, `Executive is the primary executive of ${n} propert${n === 1 ? 'y' : 'ies'}; reassign or remove them first`);
  }
}

export const listExecutives = async (f: { teamId?: string; isActive?: boolean; search?: string }) =>
  (await repo.list(f)).map(toExecutiveDto);

export const getExecutiveDetails = async (id: string) => toExecutiveDto(await getExecutive(id));

export async function createExecutive(input: {
  name: string;
  email: string;
  phone?: string | null;
  username: string;
  password: string;
  teamId?: string | null;
}) {
  if (input.teamId) await assertTeamAssignable(input.teamId);
  const id = await repo.insert({
    name: input.name,
    email: input.email,
    phone: input.phone ?? null,
    username: input.username,
    passwordHash: await hashPassword(input.password),
    teamId: input.teamId ?? null,
  });
  return reload(id);
}

export async function updateExecutive(
  id: string,
  input: { name?: string; email?: string; phone?: string | null; username?: string; teamId?: string | null },
) {
  const exec = await getExecutive(id);
  const { teamId, ...profile } = input;
  if (teamId !== undefined) await assertCanLeaveTeam(exec, teamId);
  if (teamId && teamId !== exec.team_id) await assertCanJoinTeam(exec, teamId);
  await repo.updateProfile(id, { ...profile, team_id: teamId });
  return reload(id);
}

export async function changePassword(id: string, password: string): Promise<void> {
  await getExecutive(id);
  await repo.setPasswordHash(id, await hashPassword(password));
}

export async function setStatus(id: string, isActive: boolean) {
  await getExecutive(id);
  await repo.setActive(id, isActive);
  return reload(id);
}

export async function deleteExecutive(id: string) {
  await getExecutive(id);
  await repo.softDelete(id);
  const row = await repo.findById(id);
  return toExecutiveDto(row!);
}

export async function assignTeam(id: string, teamId: string) {
  const exec = await getExecutive(id);
  await assertCanJoinTeam(exec, teamId);
  await assertCanLeaveTeam(exec, teamId);
  await repo.setTeam(id, teamId);
  return reload(id);
}

export async function removeFromTeam(id: string) {
  await assertCanLeaveTeam(await getExecutive(id), null);
  await repo.setTeam(id, null);
  return reload(id);
}
