export type ProjectStatus = 'ACTIVE' | 'ARCHIVED';

export interface ProjectRow {
  id: string;
  project_code: string;
  name: string;
  description: string | null;
  location: string | null;
  status: ProjectStatus;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  property_count?: number;
  inventory_count?: number;
}

export const toProjectDto = (p: ProjectRow) => ({
  id: p.id,
  projectCode: p.project_code,
  name: p.name,
  description: p.description,
  location: p.location,
  status: p.status,
  propertyCount: p.property_count ?? 0,
  inventoryCount: p.inventory_count ?? 0,
  createdBy: p.created_by,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});
