/** ADMIN manages everything; MANAGER leads teams and assigns leads to them; SALES works leads. */
export const USER_ROLES = ['ADMIN', 'MANAGER', 'SALES'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Display category, kept apart from the role so no permission logic hangs on it. Sales Executive and
 * Executive Manager are both role SALES and have identical permissions.
 */
export const USER_DESIGNATIONS = ['MANAGER', 'SALES_EXECUTIVE', 'EXECUTIVE_MANAGER'] as const;
export type UserDesignation = (typeof USER_DESIGNATIONS)[number];
export const SALES_DESIGNATIONS = ['SALES_EXECUTIVE', 'EXECUTIVE_MANAGER'] as const;

/** Full DB row. Contains password_hash: never send this to a client. */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  username: string;
  password_hash: string;
  role: UserRole;
  designation: UserDesignation | null;
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
  designation: UserDesignation | null;
}

export const toPublicUser = (u: UserRecord): PublicUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  designation: u.designation,
});
