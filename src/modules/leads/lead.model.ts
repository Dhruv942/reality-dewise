import type { AssignmentReason, AssignmentType } from '../assignment/assignment.model';
import type { PropertySource } from '../properties/property.model';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'SITE_VISIT', 'NEGOTIATION', 'WON', 'LOST'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadRow {
  id: string;
  status: LeadStatus;
  message: string | null;
  external_lead_id: string | null;
  source: PropertySource;
  created_at: Date;
  updated_at: Date;
  customer_id: string;
  customer_name: string;
  customer_mobile: string;
  customer_email: string | null;
  property_id: string;
  property_name: string;
  external_property_id: string;
  property_location: string | null;
  executive_id: string | null;
  executive_name: string | null;
  assignment_type: AssignmentType | null;
  assignment_reason: AssignmentReason | null;
}

export const toLeadDto = (l: LeadRow) => ({
  id: l.id,
  status: l.status,
  message: l.message,
  externalLeadId: l.external_lead_id,
  source: l.source,
  customer: { id: l.customer_id, name: l.customer_name, mobile: l.customer_mobile, email: l.customer_email },
  // The property the customer is asking about.
  property: {
    id: l.property_id,
    name: l.property_name,
    externalPropertyId: l.external_property_id,
    location: l.property_location,
  },
  assignedExecutive: l.executive_id ? { id: l.executive_id, name: l.executive_name } : null,
  assignment: l.assignment_type ? { type: l.assignment_type, reason: l.assignment_reason } : null,
  createdAt: l.created_at,
  updatedAt: l.updated_at,
});
