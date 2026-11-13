export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

export const toNoteDto = (n: NoteRow) => ({
  id: n.id,
  title: n.title,
  content: n.content,
  createdAt: n.created_at,
  updatedAt: n.updated_at,
});
