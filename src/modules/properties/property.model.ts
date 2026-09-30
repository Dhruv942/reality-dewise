export const PROPERTY_SOURCES = ['99ACRES', 'MAGICBRICKS'] as const;
export type PropertySource = (typeof PROPERTY_SOURCES)[number];

export interface PropertyRow {
  id: string;
  external_property_id: string;
  source: PropertySource;
  name: string;
  description: string | null;
  location: string | null;
  is_active: boolean;
  team_id: string | null;
  team_name: string | null;
  team_is_active: boolean | null;
  primary_executive_id: string | null;
  primary_executive_name: string | null;
  primary_executive_is_active: boolean | null;
  created_at: Date;
  updated_at: Date;
}

export const toPropertyDto = (p: PropertyRow) => ({
  id: p.id,
  externalPropertyId: p.external_property_id,
  source: p.source,
  name: p.name,
  description: p.description,
  location: p.location,
  isActive: p.is_active,
  team: p.team_id ? { id: p.team_id, name: p.team_name, isActive: p.team_is_active } : null,
  primaryExecutive: p.primary_executive_id
    ? { id: p.primary_executive_id, name: p.primary_executive_name, isActive: p.primary_executive_is_active }
    : null,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});
