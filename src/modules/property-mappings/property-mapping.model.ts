export interface PropertyMappingRow {
  id: string;
  property_id: string;
  property_name: string;
  portal_source: string;
  external_property_id: string | null;
  external_property_name: string | null;
  normalized_property_name: string;
  external_listing_url: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toPropertyMappingDto = (m: PropertyMappingRow) => ({
  id: m.id,
  propertyId: m.property_id,
  propertyName: m.property_name,
  portalSource: m.portal_source,
  externalPropertyId: m.external_property_id,
  externalPropertyName: m.external_property_name,
  normalizedPropertyName: m.normalized_property_name,
  externalListingUrl: m.external_listing_url,
  isActive: m.is_active,
  createdBy: m.created_by,
  updatedBy: m.updated_by,
  createdAt: m.created_at,
  updatedAt: m.updated_at,
});
