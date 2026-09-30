export interface TeamRecord {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type TeamWithCount = TeamRecord & { executive_count: number };

export const toTeamDto = (t: TeamWithCount) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  isActive: t.is_active,
  /** Active, non-deleted executives: exactly the pool round-robin will draw from. */
  executiveCount: t.executive_count,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});
