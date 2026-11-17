import type { Request, Response } from 'express';
import { ValidationError, AppError } from '../../utils/errors';

const queryText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * Initial OAuth boundary only. Code exchange, state verification and token
 * persistence belong behind this boundary when the Zoho integration is added.
 */
export function handleZohoOAuthCallback(req: Request, res: Response): void {
  const error = queryText(req.query.error);
  if (error) {
    // Do not echo provider error, description, code or state values.
    throw new AppError(400, 'Zoho authorization was not granted');
  }

  const code = queryText(req.query.code);
  const state = queryText(req.query.state);
  const errors: { field: string; message: string }[] = [];
  if (!code) errors.push({ field: 'code', message: 'OAuth code is required' });
  if (!state) errors.push({ field: 'state', message: 'OAuth state is required' });
  if (errors.length) throw new ValidationError(errors);

  // Deliberately do not log or return code/state. This route only confirms receipt.
  res.json({
    success: true,
    message: 'Zoho OAuth callback received',
    nextStep: 'authorization_code_exchange_pending',
  });
}
