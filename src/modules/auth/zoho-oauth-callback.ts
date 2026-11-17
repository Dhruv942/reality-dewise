import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { ValidationError, AppError } from '../../utils/errors';
import * as zoho from '../zoho/zoho.service';

const queryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export async function handleZohoOAuthCallback(req: Request, res: Response): Promise<void> {
  const error = queryText(req.query.error);
  if (error) throw new AppError(400, 'Zoho authorization was not granted');
  const code = queryText(req.query.code);
  const state = queryText(req.query.state);
  const errors: { field: string; message: string }[] = [];
  if (!code) errors.push({ field: 'code', message: 'OAuth code is required' });
  if (!state) errors.push({ field: 'state', message: 'OAuth state is required' });
  if (errors.length) throw new ValidationError(errors);
  if (!zoho.isConfigured()) {
    res.status(503).json({ success: false, message: 'Zoho Mail integration is not configured' });
    return;
  }
  try {
    await zoho.completeCallback({ code, state });
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/settings/email-integration?zoho=connected`);
  } catch (err) {
    console.error('Zoho OAuth callback failed:', err instanceof Error ? err.message : 'unknown error');
    res.redirect(`${env.FRONTEND_URL.replace(/\/$/, '')}/settings/email-integration?zoho=error`);
  }
}

export const connectZoho = async (req: Request, res: Response) => {
  res.redirect(await zoho.beginConnect(req.user!.id));
};
