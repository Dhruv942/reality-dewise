import { pool } from '../../database/pool';
import type { Db } from '../../database/transaction';
import type { ZohoIntegrationRow } from './zoho.types';

export async function createOAuthState(adminId: string, stateHash: string, expiresAt: Date): Promise<void> {
  await pool.query('INSERT INTO zoho_oauth_states (admin_id, state_hash, expires_at) VALUES ($1, $2, $3)', [adminId, stateHash, expiresAt]);
}

export async function consumeOAuthState(db: Db, stateHash: string): Promise<{ admin_id: string } | null> {
  const { rows } = await db.query<{ admin_id: string }>(
    `UPDATE zoho_oauth_states SET used_at = now()
     WHERE state_hash = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING admin_id`,
    [stateHash],
  );
  return rows[0] ?? null;
}

export async function getIntegration(): Promise<ZohoIntegrationRow | null> {
  const { rows } = await pool.query<ZohoIntegrationRow>('SELECT * FROM zoho_mail_integrations WHERE singleton_key = true LIMIT 1');
  return rows[0] ?? null;
}

export async function saveIntegration(input: {
  adminId: string;
  accountId: string;
  senderEmail: string;
  encryptedRefreshToken: string;
  encryptedAccessToken: string;
  accessTokenExpiresAt: Date;
  accountsBaseUrl: string;
  mailBaseUrl: string;
}): Promise<ZohoIntegrationRow> {
  const { rows } = await pool.query<ZohoIntegrationRow>(
    `INSERT INTO zoho_mail_integrations
       (connected_by_admin_id, account_id, sender_email, encrypted_refresh_token, encrypted_access_token,
        access_token_expires_at, accounts_base_url, mail_base_url, status, notification_enabled,
        last_successful_verification_at, last_error, connected_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'CONNECTED',true,now(),NULL,now(),now())
     ON CONFLICT (singleton_key) DO UPDATE SET
       connected_by_admin_id = EXCLUDED.connected_by_admin_id, account_id = EXCLUDED.account_id,
       sender_email = EXCLUDED.sender_email, encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       encrypted_access_token = EXCLUDED.encrypted_access_token, access_token_expires_at = EXCLUDED.access_token_expires_at,
       accounts_base_url = EXCLUDED.accounts_base_url, mail_base_url = EXCLUDED.mail_base_url,
       status = 'CONNECTED', last_successful_verification_at = now(), last_error = NULL,
       connected_at = now(), updated_at = now()
     RETURNING *`,
    [input.adminId, input.accountId, input.senderEmail, input.encryptedRefreshToken, input.encryptedAccessToken, input.accessTokenExpiresAt, input.accountsBaseUrl, input.mailBaseUrl],
  );
  return rows[0];
}

export async function updateAccessToken(id: string, encryptedAccessToken: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `UPDATE zoho_mail_integrations SET encrypted_access_token = $2, access_token_expires_at = $3,
       status = 'CONNECTED', last_successful_verification_at = now(), last_error = NULL, updated_at = now()
     WHERE id = $1`,
    [id, encryptedAccessToken, expiresAt],
  );
}

export async function markReauthRequired(id: string, error: string): Promise<void> {
  await pool.query(`UPDATE zoho_mail_integrations SET status = 'REAUTH_REQUIRED', last_error = $2, updated_at = now() WHERE id = $1`, [id, error.slice(0, 500)]);
}

export async function disconnect(): Promise<void> {
  await pool.query(`UPDATE zoho_mail_integrations SET status = 'DISCONNECTED', encrypted_access_token = NULL, encrypted_refresh_token = '', updated_at = now() WHERE singleton_key = true`);
}
