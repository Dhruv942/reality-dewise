import type { PriceBand, PropertyType, TransactionType } from '../catalog/catalog.policy';

export const PROPERTY_SOURCES = ['99ACRES', 'MAGICBRICKS'] as const;
export type PropertySource = (typeof PROPERTY_SOURCES)[number];

export interface PropertyRow {
  id: string;
  name: string;
  description: string | null;
  location: string | null;
  project_id: string | null;
  transaction_type: TransactionType | null;
  property_type: PropertyType | null;
  min_price: string | null;
  max_price: string | null;
  currency: string;
  price_band: PriceBand | null;
  is_active: boolean;
  is_stub: boolean;
  archived_at: Date | null;
  executive_count: number;
  pending_lead_count: number;
  inventory_count: number;
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
  projectId: p.project_id,
  transactionType: p.transaction_type,
  propertyType: p.property_type,
  minPrice: p.min_price === null ? null : Number(p.min_price),
  maxPrice: p.max_price === null ? null : Number(p.max_price),
  currency: p.currency,
  priceBand: p.price_band,
  isActive: p.is_active,
  // Created automatically from a lead's property name; an admin can fill in details later.
  isStub: p.is_stub,
  isArchived: p.archived_at !== null,
  assignedExecutiveCount: p.executive_count,
  // true => leads for this property are saved as PENDING_ASSIGNMENT until executives are assigned.
  needsAssignment: p.executive_count === 0,
  pendingLeadCount: p.pending_lead_count,
  inventoryCount: p.inventory_count,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});
