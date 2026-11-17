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
import { AppError } from '../../utils/errors';
import * as executiveRepo from '../executives/executive.repository';

export const SETTING_KEY_UNMATCHED_PROPERTY_ROUTING = 'unmatched_property_routing';

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

const defaultUnmatchedRouting = { mode: 'ADMIN_QUEUE' as const, managerId: null as string | null };

export async function getUnmatchedPropertyRoutingSetting() {
  const row = await repo.getSetting(SETTING_KEY_UNMATCHED_PROPERTY_ROUTING);
  if (!row) return { ...defaultUnmatchedRouting, updatedAt: null, updatedBy: null };
  try {
    const value = JSON.parse(row.value) as { mode?: string; managerId?: string | null };
    const mode = value.mode === 'DESIGNATED_MANAGER' ? 'DESIGNATED_MANAGER' : 'ADMIN_QUEUE';
    return { mode, managerId: mode === 'DESIGNATED_MANAGER' ? value.managerId ?? null : null, updatedAt: row.updated_at, updatedBy: row.updated_by_id ? { id: row.updated_by_id, name: row.updated_by_name } : null };
  } catch {
    return { ...defaultUnmatchedRouting, updatedAt: row.updated_at, updatedBy: row.updated_by_id ? { id: row.updated_by_id, name: row.updated_by_name } : null };
  }
}

export async function setUnmatchedPropertyRouting(input: { mode: 'ADMIN_QUEUE' | 'DESIGNATED_MANAGER'; managerId?: string | null }, adminId: string) {
  const managerId = input.mode === 'DESIGNATED_MANAGER' ? input.managerId ?? null : null;
  if (input.mode === 'DESIGNATED_MANAGER') {
    if (!managerId) throw new AppError(400, 'managerId is required for DESIGNATED_MANAGER routing');
    const manager = await executiveRepo.findById(managerId);
    if (!manager || manager.deleted_at || manager.role !== 'MANAGER') throw new AppError(400, 'Manager not found');
    if (!manager.is_active) throw new AppError(409, 'Manager is inactive');
  }
  await repo.upsertSetting(SETTING_KEY_UNMATCHED_PROPERTY_ROUTING, JSON.stringify({ mode: input.mode, managerId }), adminId);
  return getUnmatchedPropertyRoutingSetting();
}
