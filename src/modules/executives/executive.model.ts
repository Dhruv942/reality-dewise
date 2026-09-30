import type { UserRole } from '../users/user.model';

/** users row joined with its team. Deliberately has no password_hash. */
export interface ExecutiveRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  username: string;
  role: UserRole;
  is_active: boolean;
  team_id: string | null;
  team_name: string | null;
  team_is_active: boolean | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export const toExecutiveDto = (e: ExecutiveRow) => ({
  id: e.id,
  name: e.name,
  email: e.email,
  phone: e.phone,
  username: e.username,
  role: e.role,
  isActive: e.is_active,
  team: e.team_id ? { id: e.team_id, name: e.team_name, isActive: e.team_is_active } : null,
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});
