import { AppError, NotFoundError } from '../../utils/errors';
import * as teams from './team.repository';
import * as executives from '../executives/executive.repository';
import { toExecutiveDto } from '../executives/executive.model';
import { toTeamDto, type TeamWithCount } from './team.model';

async function getTeam(id: string): Promise<TeamWithCount> {
  const team = await teams.findById(id);
  if (!team) throw new NotFoundError('Team not found');
  return team;
}

const teamMembers = async (teamId: string) =>
  (await executives.list({ teamId })).map((e) => {
    const { team: _team, ...rest } = toExecutiveDto(e);
    return rest;
  });

export const listTeams = async (f: { isActive?: boolean; search?: string }) => (await teams.list(f)).map(toTeamDto);

export async function getTeamDetails(id: string) {
  const team = await getTeam(id);
  return { ...toTeamDto(team), executives: await teamMembers(id) };
}

export async function getTeamExecutives(id: string) {
  const team = await getTeam(id);
  return { team: { id: team.id, name: team.name }, executives: await teamMembers(id) };
}

export async function createTeam(input: { name: string; description?: string | null }) {
  const id = await teams.create(input.name, input.description ?? null);
  return toTeamDto(await getTeam(id));
}

export async function updateTeam(id: string, input: { name?: string; description?: string | null }) {
  await getTeam(id);
  await teams.update(id, input);
  return toTeamDto(await getTeam(id));
}

/**
 * Deactivating keeps every executive's team_id untouched: membership/history is preserved and
 * reactivating the team restores it. The team simply stops being a valid target for new
 * assignments, and future round-robin must filter on `teams.is_active AND users.is_active`.
 */
export async function setTeamStatus(id: string, isActive: boolean) {
  await getTeam(id);
  await teams.setActive(id, isActive);
  return toTeamDto(await getTeam(id));
}

/** Shared rule: a team must exist and be active to receive executives. */
export async function assertTeamAssignable(teamId: string): Promise<void> {
  const team = await teams.findById(teamId);
  if (!team) throw new AppError(400, 'Team not found');
  if (!team.is_active) throw new AppError(409, 'Team is inactive');
}
