import { pool } from '../db/pool';
import { leadRepository } from '../repositories/leadRepository';
import { noteRepository } from '../repositories/noteRepository';
import { NotFoundError } from '../utils/errors';

export async function addNote(leadId: number, input: { note: string; authorId?: number }) {
  if (!(await leadRepository.findById(pool, leadId))) throw new NotFoundError('Lead');
  return noteRepository.insert(pool, { leadId, authorId: input.authorId, note: input.note.trim() });
}

export async function listNotes(leadId: number) {
  if (!(await leadRepository.findById(pool, leadId))) throw new NotFoundError('Lead');
  return noteRepository.listByLead(pool, leadId);
}
