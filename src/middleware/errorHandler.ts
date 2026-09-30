import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError } from '../utils/errors';

const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_key: 'Email is already in use',
  users_username_key: 'Username is already in use',
  users_phone_key: 'Phone number is already in use',
  properties_source_external_property_id_key: 'A property with this source and external ID already exists',
  teams_name_lower_key: 'A team with this name already exists',
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(new NotFoundError('Route not found'));

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      ...(err.details ? { errors: err.details } : {}),
    });
    return;
  }

  // Malformed JSON / oversized body from express.json()
  const status = (err as { status?: number }).status;
  if (status && status >= 400 && status < 500 && (err as { type?: string }).type) {
    res.status(status).json({
      success: false,
      message: status === 413 ? 'Request body too large' : 'Malformed request body',
    });
    return;
  }

  // Postgres errors: map known constraint classes, never leak SQL details.
  const pgCode = (err as { code?: string }).code;
  if (pgCode === '23505') {
    const constraint = (err as { constraint?: string }).constraint ?? '';
    res.status(409).json({ success: false, message: UNIQUE_MESSAGES[constraint] ?? 'Resource already exists' });
    return;
  }
  if (pgCode === '23503') {
    res.status(409).json({ success: false, message: 'Operation conflicts with related data' });
    return;
  }
  if (pgCode === '23502' || pgCode === '23514' || pgCode === '22P02') {
    res.status(400).json({ success: false, message: 'Invalid data' });
    return;
  }

  console.error('Unhandled error:', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error');
  res.status(500).json({ success: false, message: 'Internal server error' });
};
