import { withTransaction } from '../../database/transaction';
import { AppError, NotFoundError } from '../../utils/errors';
import * as repo from './project.repository';
import { toProjectDto } from './project.model';

const get = async (id: string) => {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('Project not found');
  return row;
};

export const list = async (f: Parameters<typeof repo.list>[0]) => (await repo.list(f)).map(toProjectDto);

export async function create(input: { name: string; description?: string | null; location?: string | null; createdBy: string }) {
  const id = await withTransaction((tx) => repo.insert(tx, input));
  return toProjectDto(await get(id));
}

export async function details(id: string) {
  const result = await repo.details(id);
  if (!result) throw new NotFoundError('Project not found');
  return { ...toProjectDto(result.project), properties: result.properties };
}

export async function update(id: string, input: { name?: string; description?: string | null; location?: string | null }) {
  await get(id);
  await repo.update(id, input);
  return toProjectDto(await get(id));
}

export async function archive(id: string) {
  const project = await get(id);
  if (project.status === 'ARCHIVED') return toProjectDto(project);
  await repo.archive(id);
  return toProjectDto(await get(id));
}

export async function assertActive(id: string) {
  const project = await get(id);
  if (project.status !== 'ACTIVE') throw new AppError(409, 'Project is archived');
  return project;
}
