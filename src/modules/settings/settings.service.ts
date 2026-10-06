import {
  ASSIGNMENT_RULES,
  ASSIGNMENT_RULE_INFO,
  DEFAULT_ASSIGNMENT_RULE,
  DEFAULT_LEAD_TIMEOUT_MINUTES,
  MAX_LEAD_TIMEOUT_MINUTES,
  MIN_LEAD_TIMEOUT_MINUTES,
  SETTING_KEY_ASSIGNMENT_RULE,
  SETTING_KEY_LEAD_TIMEOUT,
  type AssignmentRule,
} from '../assignment/assignment.rules';
import * as repo from './settings.repository';

/** The current rule plus everything a settings screen needs (the choices, the default, who changed it and when). */
export async function getAssignmentRuleSetting() {
  const row = await repo.getSetting(SETTING_KEY_ASSIGNMENT_RULE);
  const rule = await repo.getAssignmentRule();
  return {
    rule,
    defaultRule: DEFAULT_ASSIGNMENT_RULE,
    isDefault: rule === DEFAULT_ASSIGNMENT_RULE,
    availableRules: ASSIGNMENT_RULES.map((value) => ({ value, ...ASSIGNMENT_RULE_INFO[value] })),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by_id ? { id: row.updated_by_id, name: row.updated_by_name } : null,
  };
}

/** Only called from the admin-only route. Takes effect for the next lead that is assigned. */
export async function setAssignmentRule(rule: AssignmentRule, adminId: string) {
  await repo.upsertSetting(SETTING_KEY_ASSIGNMENT_RULE, rule, adminId);
  return getAssignmentRuleSetting();
}

/** The lead timeout (minutes) plus its default, limits and who last changed it. */
export async function getLeadTimeoutSetting() {
  const row = await repo.getSetting(SETTING_KEY_LEAD_TIMEOUT);
  const minutes = await repo.getLeadTimeoutMinutes();
  return {
    minutes,
    defaultMinutes: DEFAULT_LEAD_TIMEOUT_MINUTES,
    isDefault: minutes === DEFAULT_LEAD_TIMEOUT_MINUTES,
    minMinutes: MIN_LEAD_TIMEOUT_MINUTES,
    maxMinutes: MAX_LEAD_TIMEOUT_MINUTES,
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by_id ? { id: row.updated_by_id, name: row.updated_by_name } : null,
  };
}

/** Only called from the admin-only route. Leads already assigned are measured against the new value from now on. */
export async function setLeadTimeoutMinutes(minutes: number, adminId: string) {
  await repo.upsertSetting(SETTING_KEY_LEAD_TIMEOUT, String(minutes), adminId);
  return getLeadTimeoutSetting();
}
