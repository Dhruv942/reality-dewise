export const ASSIGNMENT_TYPES = ['PRIMARY', 'ROUND_ROBIN'] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const ASSIGNMENT_REASONS = [
  'PRIMARY_EXECUTIVE_AVAILABLE',
  'PRIMARY_EXECUTIVE_UNAVAILABLE',
  'NO_PRIMARY_EXECUTIVE',
] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

export interface AssignmentResult {
  historyId: string;
  propertyId: string;
  teamId: string;
  leadId: string;
  executiveId: string;
  assignmentType: AssignmentType;
  reason: AssignmentReason;
  /** true when this lead had already been assigned (retry): nothing new was recorded. */
  alreadyAssigned: boolean;
}

export interface AssignmentHistoryRow {
  id: string;
  property_id: string;
  team_id: string;
  executive_id: string;
  assignment_type: AssignmentType;
  reason: AssignmentReason;
  lead_id: string | null;
  created_at: Date;
  executive_name?: string;
  executive_username?: string;
}

export const toHistoryDto = (h: AssignmentHistoryRow) => ({
  id: h.id,
  propertyId: h.property_id,
  teamId: h.team_id,
  executive: { id: h.executive_id, name: h.executive_name, username: h.executive_username },
  assignmentType: h.assignment_type,
  reason: h.reason,
  leadId: h.lead_id,
  createdAt: h.created_at,
});
