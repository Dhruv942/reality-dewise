export interface TeamRecord {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  manager_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

export type TeamWithCount = TeamRecord & {
  executive_count: number;
  manager_id: string | null;
  manager_name: string | null;
};

export const toTeamDto = (t: TeamWithCount) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  isActive: t.is_active,
  // The manager who leads this team and can assign leads to its members.
  manager: t.manager_id ? { id: t.manager_id, name: t.manager_name } : null,
  /** Active, non-deleted executives: exactly the pool round-robin will draw from. */
  executiveCount: t.executive_count,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});
