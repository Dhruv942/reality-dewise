import type { ManualLeadSubSource, PropertySource } from '../properties/property.model';

export const LEAD_STATUSES = ['PENDING_ASSIGNMENT', 'INCOMING', 'RINGING', 'CONNECTED', 'CLOSED', 'LOST', 'INVALID', 'BROKER'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const INVALID_REASONS = ['NO_REQUIREMENT', 'NOT_ABLE_TO_CONNECT', 'OUT_OF_SERVICE_AREA', 'OTHER'] as const;
export const LOST_REASONS = ['BUDGET_ISSUE', 'NOT_RESPONDING_PREVIOUSLY_CONNECTED', 'BOOKED_OTHER_CHANNEL', 'CHANGED_OR_DIFFERED_PLAN', 'OTHER'] as const;
export const STATUS_REASONS = ['NO_REQUIREMENT', 'NOT_ABLE_TO_CONNECT', 'OUT_OF_SERVICE_AREA', 'BUDGET_ISSUE', 'NOT_RESPONDING_PREVIOUSLY_CONNECTED', 'BOOKED_OTHER_CHANNEL', 'CHANGED_OR_DIFFERED_PLAN', 'OTHER'] as const;
export type StatusReasonCode = (typeof INVALID_REASONS)[number] | (typeof LOST_REASONS)[number];
/** Statuses a person may set. PENDING_ASSIGNMENT is system-managed: it ends when an executive is assigned. */
export const PIPELINE_STATUSES = LEAD_STATUSES.filter((s) => s !== 'PENDING_ASSIGNMENT') as Exclude<LeadStatus, 'PENDING_ASSIGNMENT'>[];

export const ENQUIRY_TYPES = ['RENT', 'BUY', 'PROJECT'] as const;
export type EnquiryType = (typeof ENQUIRY_TYPES)[number];
export const LEAD_TYPES = ['INDIVIDUAL', 'BROKER_AGENT'] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export interface LeadRow {
  id: string;
  status: LeadStatus;
  status_reason: StatusReasonCode | null;
  status_reason_other: string | null;
  message: string | null;
  is_important: boolean; // the viewing user's own flag
  lead_no: string; // bigint comes back from pg as a string
  requirement: string | null;
  assigned_at: Date | null;
  seen_at: Date | null;
  enquiry_type: EnquiryType | null;
  lead_type: LeadType | null;
  budget: string | null; // numeric comes back from pg as a string
  requested_property_name: string | null;
  external_lead_id: string | null;
  external_property_id: string | null;
  external_property_name: string | null;
  external_property_url: string | null;
  property_match_status: 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'RESOLVED' | 'CONFLICT';
  property_match_method: string | null;
  property_match_confidence: string | null;
  property_match_candidates: unknown;
  property_review_manager_id: string | null;
  source: PropertySource;
  manual_sub_source: ManualLeadSubSource | null;
  created_at: Date;
  updated_at: Date;
  customer_id: string;
  customer_name: string;
  customer_mobile: string;
  customer_email: string | null;
  property_id: string;
  property_name: string;
  property_location: string | null;
  executive_id: string | null;
  executive_name: string | null;
  /** The admin's SLA setting at the time of the query (minutes). */
  sla_minutes: number;
  follow_up_at: Date | null;
  follow_up_note: string | null;
  follow_up_updated_by: string | null;
  follow_up_updated_by_name: string | null;
  follow_up_updated_at: Date | null;
}

export const FOLLOW_UP_STATES = ['OVERDUE', 'TODAY', 'UPCOMING'] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];

/** The calendar day (YYYY-MM-DD) of `d` in the IANA zone `tz`. */
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * Where a follow-up stands: OVERDUE (already past), TODAY (still to come today in `tz`) or UPCOMING (a later day).
 * Informational only: it never changes assignment or the SLA.
 */
export function followUpState(at: Date, now: Date, tz = 'UTC'): FollowUpState {
  if (at.getTime() <= now.getTime()) return 'OVERDUE';
  return dayIn(at, tz) === dayIn(now, tz) ? 'TODAY' : 'UPCOMING';
}

/** Whether `tz` is an IANA timezone name this runtime knows. */
export const isValidTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const toLeadDto = (l: LeadRow, tz = 'UTC') => ({
  id: l.id,
  leadNo: Number(l.lead_no),
  // Per user: true only if the logged-in user marked this lead important. Never reflects anyone else's flag.
  isImportant: l.is_important,
  status: l.status,
  statusReason: l.status_reason ? { code: l.status_reason, other: l.status_reason_other } : null,
  message: l.message,
  requirement: l.requirement,
  // Whether the client wants to rent or buy. null when the enquiry did not say.
  enquiryType: l.enquiry_type,
  leadType: l.lead_type,
  budget: l.budget === null ? null : Number(l.budget),
  requestedPropertyName: l.requested_property_name,
  externalLeadId: l.external_lead_id,
  externalProperty: {
    id: l.external_property_id,
    name: l.external_property_name,
    url: l.external_property_url,
  },
  propertyMatch: {
    status: l.property_match_status,
    method: l.property_match_method,
    confidence: l.property_match_confidence === null ? null : Number(l.property_match_confidence),
    candidates: l.property_match_candidates ?? [],
    reviewManagerId: l.property_review_manager_id,
  },
  source: l.source,
  manualSubSource: l.manual_sub_source,
  customer: { id: l.customer_id, name: l.customer_name, mobile: l.customer_mobile, email: l.customer_email },
  // The property the customer is asking about.
  property: {
    id: l.property_id,
    name: l.property_name,
    location: l.property_location,
  },
  assignedExecutive: l.executive_id ? { id: l.executive_id, name: l.executive_name } : null,
  // For the assigned executive: true until they first open the lead (the "New / Assigned to you" badge).
  isNew: l.executive_id !== null && l.seen_at === null,
  assignedAt: l.assigned_at,
  // The backend's own deadline for the assigned executive's first status change. The portal only counts down to it.
  sla:
    l.status === 'INCOMING' && l.executive_id && l.assigned_at
      ? { minutes: l.sla_minutes, deadline: new Date(l.assigned_at.getTime() + l.sla_minutes * 60_000), now: new Date() }
      : null,
  // null when nothing is scheduled. `state` is relative to now, with "today" in the requested `tz` (default UTC).
  followUp: l.follow_up_at
    ? {
        at: l.follow_up_at,
        note: l.follow_up_note,
        state: followUpState(l.follow_up_at, new Date(), tz),
        updatedBy: l.follow_up_updated_by ? { id: l.follow_up_updated_by, name: l.follow_up_updated_by_name } : null,
        updatedAt: l.follow_up_updated_at,
      }
    : null,
  createdAt: l.created_at,
  updatedAt: l.updated_at,
});
