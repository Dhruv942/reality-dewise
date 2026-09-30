import { AppError, NotFoundError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';
import { assertTeamAssignable } from '../teams/team.service';
import * as assignmentRepo from '../assignment/assignment.repository';
import { toHistoryDto } from '../assignment/assignment.model';
import * as repo from './property.repository';
import { toPropertyDto, type PropertyRow, type PropertySource } from './property.model';

async function getProperty(id: string): Promise<PropertyRow> {
  const p = await repo.findById(id);
  if (!p) throw new NotFoundError('Property not found');
  return p;
}
const reload = async (id: string) => toPropertyDto(await getProperty(id));

/**
 * A primary executive must exist, be an active EXECUTIVE and belong to the property's team.
 * (The database enforces the team match too; this gives a clear message first.)
 */
async function assertValidPrimary(executiveId: string, teamId: string): Promise<void> {
  const e = await executiveRepo.findById(executiveId);
  if (!e || e.deleted_at) throw new AppError(400, 'Executive not found');
  if (e.role !== 'EXECUTIVE') throw new AppError(400, 'User is not an executive');
  if (!e.is_active) throw new AppError(409, 'Executive is inactive');
  if (e.team_id !== teamId) throw new AppError(409, "Executive does not belong to the property's team");
}

export const listProperties = async (f: Parameters<typeof repo.list>[0]) => (await repo.list(f)).map(toPropertyDto);

export async function getPropertyDetails(id: string) {
  const p = await getProperty(id);
  const teamExecutives = p.team_id ? await executiveRepo.list({ teamId: p.team_id, isActive: true }) : [];
  return {
    ...toPropertyDto(p),
    activeTeamExecutives: teamExecutives.map((e) => ({ id: e.id, name: e.name, username: e.username })),
  };
}

export async function createProperty(input: {
  externalPropertyId: string;
  source: PropertySource;
  name: string;
  description?: string | null;
  location?: string | null;
  teamId?: string | null;
  primaryExecutiveId?: string | null;
  isActive?: boolean;
}) {
  const teamId = input.teamId ?? null;
  const primaryExecutiveId = input.primaryExecutiveId ?? null;
  if (primaryExecutiveId && !teamId) {
    throw new AppError(400, 'teamId is required when primaryExecutiveId is provided');
  }
  if (teamId) await assertTeamAssignable(teamId);
  if (primaryExecutiveId) await assertValidPrimary(primaryExecutiveId, teamId!);

  const id = await repo.insert({
    externalPropertyId: input.externalPropertyId,
    source: input.source,
    name: input.name,
    description: input.description ?? null,
    location: input.location ?? null,
    teamId,
    primaryExecutiveId,
    isActive: input.isActive ?? true,
  });
  return reload(id);
}

export async function updateProperty(
  id: string,
  input: { name?: string; description?: string | null; location?: string | null; isActive?: boolean },
) {
  await getProperty(id);
  await repo.updateDetails(id, {
    name: input.name,
    description: input.description,
    location: input.location,
    is_active: input.isActive,
  });
  return reload(id);
}

/** Inactive properties stop receiving leads; the row stays for lead history. */
export async function setPropertyStatus(id: string, isActive: boolean) {
  await getProperty(id);
  await repo.updateDetails(id, { is_active: isActive });
  return reload(id);
}

/**
 * Changing team never silently keeps an invalid primary executive and never moves executives.
 * If the current primary is not in the new team the request is refused (409) unless the same
 * request supplies `primaryExecutiveId` (a member of the new team, or null to clear it).
 */
export async function changeTeam(id: string, input: { teamId: string; primaryExecutiveId?: string | null }) {
  const p = await getProperty(id);
  await assertTeamAssignable(input.teamId);

  const newPrimary = input.primaryExecutiveId === undefined ? p.primary_executive_id : input.primaryExecutiveId;

  if (newPrimary && input.primaryExecutiveId === undefined && p.team_id !== input.teamId) {
    throw new AppError(409, "The property's primary executive does not belong to the new team", {
      code: 'PRIMARY_EXECUTIVE_TEAM_MISMATCH',
      primaryExecutive: { id: p.primary_executive_id, name: p.primary_executive_name },
      resolution: [
        'Repeat the request with "primaryExecutiveId" set to an executive of the new team, or',
        'Repeat the request with "primaryExecutiveId": null to remove the primary executive.',
      ],
    });
  }
  if (newPrimary && input.primaryExecutiveId !== undefined) await assertValidPrimary(newPrimary, input.teamId);

  await repo.setAssignment(id, { team_id: input.teamId, primary_executive_id: newPrimary });
  return reload(id);
}

export async function setPrimaryExecutive(id: string, executiveId: string) {
  const p = await getProperty(id);
  if (!p.team_id) throw new AppError(409, 'Assign a team to the property before choosing a primary executive');
  await assertValidPrimary(executiveId, p.team_id);
  await repo.setAssignment(id, { primary_executive_id: executiveId });
  return reload(id);
}

export async function removePrimaryExecutive(id: string) {
  await getProperty(id);
  await repo.setAssignment(id, { primary_executive_id: null });
  return reload(id);
}

export async function getAssignmentHistory(id: string, limit: number, offset: number) {
  const p = await getProperty(id);
  const rows = await assignmentRepo.listHistoryForProperty(id, limit, offset);
  return { property: { id: p.id, name: p.name }, limit, offset, history: rows.map(toHistoryDto) };
}

