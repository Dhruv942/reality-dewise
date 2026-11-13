import { NotFoundError } from '../../utils/errors';
import { toNoteDto } from './note.model';
import * as repo from './note.repository';

export const listMine = async (userId: string, f: { search?: string; limit: number; offset: number }) =>
  (await repo.listOwned(userId, f)).map(toNoteDto);

export async function getMine(userId: string, id: string) {
  const row = await repo.findOwned(userId, id);
  if (!row) throw new NotFoundError('Note not found');
  return toNoteDto(row);
}

export const createMine = async (userId: string, input: { title: string; content: string }) => toNoteDto(await repo.insert(userId, input));

export async function updateMine(userId: string, id: string, input: { title?: string; content?: string }) {
  const row = await repo.updateOwned(userId, id, input);
  if (!row) throw new NotFoundError('Note not found');
  return toNoteDto(row);
}

export async function deleteMine(userId: string, id: string) {
  if (!(await repo.deleteOwned(userId, id))) throw new NotFoundError('Note not found');
  return { success: true };
}
