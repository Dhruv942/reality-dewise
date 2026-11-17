export type ZohoConnectionStatus = 'CONNECTED' | 'REAUTH_REQUIRED' | 'DISCONNECTED';

export interface ZohoIntegrationRow {
  id: string;
  connected_by_admin_id: string;
  account_id: string;
  sender_email: string;
  encrypted_refresh_token: string;
  encrypted_access_token: string | null;
  access_token_expires_at: Date | null;
  accounts_base_url: string;
  mail_base_url: string;
  status: ZohoConnectionStatus;
  notification_enabled: boolean;
  last_successful_verification_at: Date | null;
  last_error: string | null;
  connected_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface ZohoAccount {
  accountId: string;
  email: string;
}

export interface ZohoSendResult {
  providerMessageId: string | null;
}

export interface ZohoEmailInput {
  toAddress: string;
  subject: string;
  htmlContent: string;
  textContent: string;
}
