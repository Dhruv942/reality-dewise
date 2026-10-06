import { z } from 'zod';
import { ASSIGNMENT_RULES, MAX_LEAD_TIMEOUT_MINUTES, MIN_LEAD_TIMEOUT_MINUTES } from '../assignment/assignment.rules';

export const updateAssignmentRuleSchema = z.strictObject({
  rule: z.enum(ASSIGNMENT_RULES, { error: `Rule must be one of: ${ASSIGNMENT_RULES.join(', ')}` }),
});

export const updateLeadTimeoutSchema = z.strictObject({
  minutes: z
    .number({ error: 'Minutes must be a number' })
    .int('Minutes must be a whole number')
    .min(MIN_LEAD_TIMEOUT_MINUTES, `Minutes must be at least ${MIN_LEAD_TIMEOUT_MINUTES}`)
    .max(MAX_LEAD_TIMEOUT_MINUTES, `Minutes must be at most ${MAX_LEAD_TIMEOUT_MINUTES}`),
});
