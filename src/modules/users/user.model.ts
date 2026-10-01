export const USER_ROLES = ['ADMIN', 'EXECUTIVE'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Full DB row. Contains password_hash: never send this to a client. */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  username: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  team_id: string | null;
  deleted_at: Date | null;
  password_changed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Safe, client-facing shape. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});
