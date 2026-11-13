/** TIMEOUT = the lead stayed INCOMING past the timeout and the system moved it to the next executive. */
export type AssignmentMethod = 'ROUND_ROBIN' | 'MANUAL' | 'TRANSFER' | 'TIMEOUT';

export interface AssignmentResult {
  historyId: string;
  propertyId: string;
  leadId: string;
  executiveId: string;
  /** true when this lead had already been assigned (retry): nothing new was recorded. */
  alreadyAssigned: boolean;
}

export interface AssignmentHistoryRow {
  id: string;
  property_id: string;
  executive_id: string;
  lead_id: string | null;
  method: AssignmentMethod;
  assigned_by_id: string | null;
  reason: string | null;
  created_at: Date;
  executive_name?: string;
  executive_username?: string;
  assigned_by_name?: string | null;
}

export const toHistoryDto = (h: AssignmentHistoryRow) => ({
  id: h.id,
  propertyId: h.property_id,
  executive: { id: h.executive_id, name: h.executive_name, username: h.executive_username },
  leadId: h.lead_id,
  // ROUND_ROBIN (system), MANUAL (initial/manual assignment), TRANSFER, or TIMEOUT.
  method: h.method,
  reason: h.reason,
  assignedBy: h.assigned_by_id ? { id: h.assigned_by_id, name: h.assigned_by_name ?? null } : null,
  createdAt: h.created_at,
});
