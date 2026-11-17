import { randomBytes } from 'node:crypto';
import { withTransaction } from '../../database/transaction';
import { env } from '../../config/env';
import { AppError } from '../../utils/errors';
import { encryptSecret, decryptSecret, hashOAuthState } from './zoho.crypto';
import * as repo from './zoho.repository';
import type { ZohoAccount, ZohoEmailInput, ZohoIntegrationRow, ZohoSendResult } from './zoho.types';

export const ZOHO_SCOPES = 'ZohoMail.accounts.READ,ZohoMail.messages.CREATE';
const STATE_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_SKEW_MS = 60_000;
const refreshLocks = new Map<string, Promise<string>>();

export const isConfigured = () => [env.ZOHO_CLIENT_ID, env.ZOHO_CLIENT_SECRET, env.ZOHO_REDIRECT_URI, env.ZOHO_ACCOUNTS_BASE_URL, env.ZOHO_MAIL_BASE_URL, env.ZOHO_TOKEN_ENCRYPTION_KEY].every(Boolean);

function config() {
  const values = [env.ZOHO_CLIENT_ID, env.ZOHO_CLIENT_SECRET, env.ZOHO_REDIRECT_URI, env.ZOHO_ACCOUNTS_BASE_URL, env.ZOHO_MAIL_BASE_URL, env.ZOHO_TOKEN_ENCRYPTION_KEY];
  if (values.some((v) => !v)) throw new AppError(503, 'Zoho Mail integration is not configured');
  return { clientId: env.ZOHO_CLIENT_ID!, clientSecret: env.ZOHO_CLIENT_SECRET!, redirectUri: env.ZOHO_REDIRECT_URI!, accountsBaseUrl: env.ZOHO_ACCOUNTS_BASE_URL!.replace(/\/$/, ''), mailBaseUrl: env.ZOHO_MAIL_BASE_URL!.replace(/\/$/, ''), encryptionKey: env.ZOHO_TOKEN_ENCRYPTION_KEY! };
}

const providerErrorCode = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return null;
  const value = (body as { error?: unknown }).error;
  return typeof value === 'string' && /^[a-z0-9_-]{1,80}$/i.test(value) ? value : null;
};

const safeProviderError = (status: number, body: unknown): Error & { status?: number; permanent?: boolean } => {
  const code = providerErrorCode(body);
  const err = new Error(`Zoho Mail request failed (${status}${code ? `: ${code}` : ''})`) as Error & { status?: number; permanent?: boolean };
  err.status = status;
  err.permanent = status === 400 || status === 401 || status === 403;
  return err;
};

async function jsonFetch(url: string, init: RequestInit): Promise<any> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('Zoho Mail network request failed');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw safeProviderError(response.status, body);
  return body;
}

const parseToken = (body: any) => {
  if (!body?.access_token || typeof body.access_token !== 'string') {
    const code = providerErrorCode(body);
    throw new AppError(502, `Zoho token exchange failed${code ? `: ${code}` : ''}`);
  }
  return { accessToken: body.access_token as string, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null, expiresIn: Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600 };
};

function parseAccounts(body: any): ZohoAccount[] {
  const accounts = Array.isArray(body?.data) ? body.data : [];
  return accounts.flatMap((a: any) => {
    const email = typeof a.primaryEmailAddress === 'string' ? a.primaryEmailAddress : typeof a.mailboxAddress === 'string' ? a.mailboxAddress : typeof a.incomingUserName === 'string' ? a.incomingUserName : null;
    return typeof a.accountId === 'string' && email ? [{ accountId: a.accountId, email }] : [];
  });
}

async function exchangeCode(code: string, c = config()) {
  const form = new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code' });
  return parseToken(await jsonFetch(`${c.accountsBaseUrl}/oauth/v2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }));
}

export async function beginConnect(adminId: string): Promise<string> {
  const c = config();
  const state = randomBytes(32).toString('base64url');
  await repo.createOAuthState(adminId, hashOAuthState(state), new Date(Date.now() + STATE_TTL_MS));
  const url = new URL(`${c.accountsBaseUrl}/oauth/v2/auth`);
  url.search = new URLSearchParams({ response_type: 'code', client_id: c.clientId, scope: ZOHO_SCOPES, redirect_uri: c.redirectUri, access_type: 'offline', prompt: 'consent', state }).toString();
  return url.toString();
}

export async function completeCallback(input: { code?: string; state?: string; error?: string }): Promise<void> {
  if (input.error) throw new AppError(400, 'Zoho authorization was not granted');
  if (!input.code || !input.state) throw new AppError(400, 'Zoho callback is missing required parameters');
  const c = config();
  const adminId = await withTransaction(async (tx) => (await repo.consumeOAuthState(tx, hashOAuthState(input.state!)))?.admin_id);
  if (!adminId) throw new AppError(400, 'Zoho OAuth state is invalid or expired');
  const token = await exchangeCode(input.code, c);
  if (!token.refreshToken) throw new AppError(502, 'Zoho did not return a refresh token; reconnect with offline access');
  const accounts = parseAccounts(await jsonFetch(`${c.mailBaseUrl}/api/accounts`, { headers: { Authorization: `Zoho-oauthtoken ${token.accessToken}`, Accept: 'application/json' } }));
  const account = accounts[0];
  if (!account) throw new AppError(502, 'No usable Zoho Mail account was returned');
  await repo.saveIntegration({ adminId, accountId: account.accountId, senderEmail: account.email, encryptedRefreshToken: encryptSecret(token.refreshToken, c.encryptionKey), encryptedAccessToken: encryptSecret(token.accessToken, c.encryptionKey), accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000), accountsBaseUrl: c.accountsBaseUrl, mailBaseUrl: c.mailBaseUrl });
}

export async function getStatus() {
  const row = await repo.getIntegration();
  if (!row || row.status === 'DISCONNECTED') return { status: 'DISCONNECTED', connectedEmail: null, notificationEnabled: false, lastError: null };
  return { status: row.status, connectedEmail: row.sender_email, notificationEnabled: row.notification_enabled, connectedAt: row.connected_at, lastSuccessfulVerificationAt: row.last_successful_verification_at, lastError: row.last_error };
}

async function refreshAccessToken(row: ZohoIntegrationRow, c: ReturnType<typeof config>): Promise<string> {
  const existing = refreshLocks.get(row.id);
  if (existing) return existing;
  const work = (async () => {
    const current = await repo.getIntegration();
    if (!current || current.status === 'DISCONNECTED') throw new AppError(409, 'Zoho Mail is disconnected');
    if (current.encrypted_access_token && current.access_token_expires_at && current.access_token_expires_at.getTime() > Date.now() + ACCESS_TOKEN_SKEW_MS) return decryptSecret(current.encrypted_access_token, c.encryptionKey);
    let refreshToken: string;
    try { refreshToken = decryptSecret(current.encrypted_refresh_token, c.encryptionKey); } catch { throw new AppError(503, 'Zoho Mail credentials are unavailable; reconnect is required'); }
    const form = new URLSearchParams({ refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'refresh_token' });
    try {
      const token = parseToken(await jsonFetch(`${current.accounts_base_url}/oauth/v2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }));
      await repo.updateAccessToken(current.id, encryptSecret(token.accessToken, c.encryptionKey), new Date(Date.now() + token.expiresIn * 1000));
      return token.accessToken;
    } catch (err) {
      if ((err as { permanent?: boolean }).permanent) await repo.markReauthRequired(current.id, 'Zoho authorization has expired or been revoked');
      throw err;
    }
  })();
  refreshLocks.set(row.id, work);
  try { return await work; } finally { refreshLocks.delete(row.id); }
}

export async function sendEmail(input: ZohoEmailInput): Promise<ZohoSendResult> {
  const c = config();
  const row = await repo.getIntegration();
  if (!row || row.status !== 'CONNECTED') throw new AppError(409, 'Zoho Mail is not connected');
  const accessToken = await refreshAccessToken(row, c);
  const body = await jsonFetch(`${row.mail_base_url}/api/accounts/${encodeURIComponent(row.account_id)}/messages`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${accessToken}`, 'content-type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ fromAddress: row.sender_email, toAddress: input.toAddress, subject: input.subject, content: input.htmlContent, htmlContent: input.htmlContent, mailFormat: 'html' }) });
  return { providerMessageId: typeof body?.data?.messageId === 'string' ? body.data.messageId : typeof body?.data?.mailId === 'string' ? body.data.mailId : null };
}

export async function disconnect(): Promise<void> { await repo.disconnect(); }

export async function sendTestEmail(toAddress: string): Promise<ZohoSendResult> {
  return sendEmail({ toAddress, subject: 'Realty Adwise CRM — Zoho Mail test', htmlContent: '<p>This is a test email from Realty Adwise CRM.</p>', textContent: 'This is a test email from Realty Adwise CRM.' });
}
