import type { InventoryStatus, PriceBand, PropertyType, TransactionType } from '../catalog/catalog.policy';

export interface InventoryRow {
  id: string;
  inventory_code: string;
  property_id: string;
  property_name: string;
  property_location: string | null;
  project_id: string | null;
  project_code: string | null;
  project_name: string | null;
  name: string;
  description: string | null;
  location: string | null;
  transaction_type: TransactionType | null;
  property_type: PropertyType | null;
  min_price: string | null;
  max_price: string | null;
  currency: string;
  price_band: PriceBand | null;
  status: InventoryStatus;
  available_from: string | null;
  archived_at: Date | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toInventoryDto = (i: InventoryRow) => ({
  id: i.id,
  inventoryCode: i.inventory_code,
  name: i.name,
  description: i.description,
  location: i.location,
  transactionType: i.transaction_type,
  propertyType: i.property_type,
  minPrice: i.min_price === null ? null : Number(i.min_price),
  maxPrice: i.max_price === null ? null : Number(i.max_price),
  currency: i.currency,
  priceBand: i.price_band,
  status: i.status,
  availableFrom: i.available_from,
  isArchived: i.archived_at !== null,
  property: { id: i.property_id, name: i.property_name, location: i.property_location },
  project: i.project_id ? { id: i.project_id, code: i.project_code, name: i.project_name } : null,
  createdBy: i.created_by,
  createdAt: i.created_at,
  updatedAt: i.updated_at,
});
