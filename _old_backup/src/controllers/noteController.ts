import { Request, Response } from 'express';
import { addNote, listNotes } from '../services/noteService';
import { addNoteSchema } from '../validators';

export async function handleAddNote(req: Request, res: Response) {
  const leadId = Number(req.params.id);
  const body = addNoteSchema.parse(req.body);
  const note = await addNote(leadId, body);
  res.status(201).json(note);
}

export async function handleListNotes(req: Request, res: Response) {
  const leadId = Number(req.params.id);
  const notes = await listNotes(leadId);
  res.json({ data: notes });
}
