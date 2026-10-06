export const PROPERTY_SOURCES = ['99ACRES', 'MAGICBRICKS'] as const;
export type PropertySource = (typeof PROPERTY_SOURCES)[number];

export interface PropertyRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  is_active: boolean;
  is_stub: boolean;
  executive_count: number;
  pending_lead_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface PropertyExecutiveRow {
  id: string;
  name: string;
  username: string;
  is_active: boolean;
}

export const toPropertyDto = (p: PropertyRow) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  location: p.location,
  isActive: p.is_active,
  // Created automatically from a lead's property name; an admin can fill in details later.
  isStub: p.is_stub,
  assignedExecutiveCount: p.executive_count,
  // true => leads for this property are saved as PENDING_ASSIGNMENT until executives are assigned.
  needsAssignment: p.executive_count === 0,
  pendingLeadCount: p.pending_lead_count,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});
