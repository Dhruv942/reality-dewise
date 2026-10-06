/**
 * The lead assignment rules the system knows. The active one is a setting (`app_settings.assignment_rule`)
 * that only an admin can change. To add a rule: add it here, register its strategy in
 * `assignment.strategies.ts`, and extend the CHECK constraint on `app_settings` in a new migration.
 */
export const ASSIGNMENT_RULES = ['ROUND_ROBIN'] as const;
export type AssignmentRule = (typeof ASSIGNMENT_RULES)[number];

/** Used when nothing has been configured (and the value written by the migration). */
export const DEFAULT_ASSIGNMENT_RULE: AssignmentRule = 'ROUND_ROBIN';

export const ASSIGNMENT_RULE_INFO: Record<AssignmentRule, { label: string; description: string }> = {
  ROUND_ROBIN: {
    label: 'Round robin',
    description:
      "New leads go to the executives picked for the lead's property one after another, in order, skipping inactive ones.",
  },
};

export const SETTING_KEY_ASSIGNMENT_RULE = 'assignment_rule';

/**
 * Lead SLA (timeout): an assigned lead that is still INCOMING after this many minutes is reassigned to the next
 * eligible executive (using the active assignment rule). Admin-configurable; 90 minutes by default.
 * The SLA runs 24/7: plain elapsed minutes since assignment, with no working hours, weekends or holidays.
 */
export const SETTING_KEY_LEAD_TIMEOUT = 'lead_timeout_minutes';
export const DEFAULT_LEAD_TIMEOUT_MINUTES = 90;
export const MIN_LEAD_TIMEOUT_MINUTES = 1;
export const MAX_LEAD_TIMEOUT_MINUTES = 10080; // 7 days
