import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';
import {
  ASSIGNMENT_RULES,
  DEFAULT_ASSIGNMENT_RULE,
  DEFAULT_LEAD_TIMEOUT_MINUTES,
  MAX_LEAD_TIMEOUT_MINUTES,
  MIN_LEAD_TIMEOUT_MINUTES,
  SETTING_KEY_ASSIGNMENT_RULE,
  SETTING_KEY_LEAD_TIMEOUT,
  type AssignmentRule,
} from '../assignment/assignment.rules';

export interface SettingRow {
  value: string;
  updated_at: Date;
  updated_by_id: string | null;
  updated_by_name: string | null;
}

export async function getSetting(key: string, db: Db = pool): Promise<SettingRow | null> {
  const { rows } = await db.query<SettingRow>(
    `SELECT s.value, s.updated_at, s.updated_by_id, u.name AS updated_by_name
     FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by_id
     WHERE s.key = $1`,
    [key],
  );
  return rows[0] ?? null;
}

export async function upsertSetting(key: string, value: string, updatedById: string): Promise<void> {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_by_id, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by_id = EXCLUDED.updated_by_id, updated_at = now()`,
    [key, value, updatedById],
  );
}

/**
 * The active lead assignment rule. Falls back to the default (ROUND_ROBIN) when nothing is stored, so
 * assignment keeps working on a database where the setting row is missing. Pass `db` (a transaction client)
 * to read it inside the assignment transaction.
 */
export async function getAssignmentRule(db: Db = pool): Promise<AssignmentRule> {
  const row = await getSetting(SETTING_KEY_ASSIGNMENT_RULE, db);
  return (ASSIGNMENT_RULES as readonly string[]).includes(row?.value ?? '')
    ? (row!.value as AssignmentRule)
    : DEFAULT_ASSIGNMENT_RULE;
}

/** The lead timeout in minutes (default 90 when nothing valid is stored). */
export async function getLeadTimeoutMinutes(db: Db = pool): Promise<number> {
  const row = await getSetting(SETTING_KEY_LEAD_TIMEOUT, db);
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= MIN_LEAD_TIMEOUT_MINUTES && n <= MAX_LEAD_TIMEOUT_MINUTES
    ? n
    : DEFAULT_LEAD_TIMEOUT_MINUTES;
}
