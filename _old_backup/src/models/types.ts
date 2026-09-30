export type LeadStatus = 'NEW' | 'ASSIGNED' | 'CONTACTED' | 'FOLLOW_UP' | 'CLOSED' | 'LOST' | 'INVALID';
export type AssignmentStatus = 'ACTIVE' | 'ATTENDED' | 'SLA_EXPIRED' | 'RELEASED';
export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'MISSED' | 'CANCELLED';
export type EnquiryStatus = 'PENDING' | 'CONVERTED' | 'CANCELLED';
export type ProjectStatus = 'UPCOMING' | 'ONGOING' | 'COMPLETED' | 'INACTIVE';
export type Availability = 'AVAILABLE' | 'BLOCKED' | 'SOLD';
export type NotificationType = 'LEAD_ASSIGNED' | 'LEAD_REASSIGNED' | 'FOLLOW_UP_DUE' | 'SLA_APPROACHING' | 'SLA_EXPIRED';

export interface Team { id: number; name: string; isActive: boolean; lastAssignedUserId: number | null; createdAt: Date; updatedAt: Date }
export interface User { id: number; name: string; mobile: string | null; email: string | null; isActive: boolean; teamId: number | null }
export interface Project { id: number; name: string; location: string | null; status: ProjectStatus; teamId: number | null; slaMinutes: number | null }
export interface Customer { id: number; name: string; mobile: string; email: string | null; createdAt: Date }
export interface Property { id: number; projectId: number; unitNumber: string; propertyType: string; bhk: number | null; price: number; areaSqft: number | null; availability: Availability; metadata: Record<string, unknown> }
export interface Enquiry {
  id: number; name: string; mobile: string; email: string | null; requirement: string | null; bhk: number | null;
  budget: number | null; projectId: number | null; customerId: number | null; status: EnquiryStatus;
  notes: string | null; createdBy: number | null; convertedAt: Date | null;
}
export interface Lead {
  id: number; customerId: number; projectId: number; propertyId: number | null; enquiryId: number | null;
  source: string; externalId: string | null; requirement: string | null; budget: number | null; status: LeadStatus;
  assignedTo: number | null; assignedAt: Date | null; slaDeadline: Date | null; contactedAt: Date | null;
  reassignCount: number; createdAt: Date; updatedAt: Date;
}
/** Lead row joined with what assignment needs from its project. */
export interface LockedLead extends Lead { projectTeamId: number | null; projectSlaMinutes: number | null }
export interface LeadAssignment {
  id: number; leadId: number; userId: number; teamId: number; status: AssignmentStatus; reason: string;
  assignedAt: Date; slaDeadline: Date; attendedAt: Date | null; endedAt: Date | null;
}
export interface FollowUp {
  id: number; leadId: number; assignedTo: number | null; scheduledAt: Date; status: FollowUpStatus;
  notes: string | null; completedAt: Date | null; reminderSentAt: Date | null;
}
