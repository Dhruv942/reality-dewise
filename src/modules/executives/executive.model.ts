import type { UserDesignation, UserRole } from '../users/user.model';

/** users row joined with its manager. Deliberately has no password_hash. */
export interface ExecutiveRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  username: string;
  role: UserRole;
  designation: UserDesignation | null;
  is_active: boolean;
  manager_id: string | null;
  manager_name: string | null;
  manager_is_active: boolean | null;
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
  designation: e.designation,
  isActive: e.is_active,
  // The manager this sales user reports to (always null for admins and managers).
  manager: e.manager_id ? { id: e.manager_id, name: e.manager_name, isActive: e.manager_is_active } : null,
  createdAt: e.created_at,
  updatedAt: e.updated_at,
});
