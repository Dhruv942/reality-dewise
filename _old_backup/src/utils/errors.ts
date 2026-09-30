import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) { super(400, 'VALIDATION_ERROR', message, details); }
}
export class NotFoundError extends AppError {
  constructor(entity: string) { super(404, 'NOT_FOUND', `${entity} not found`); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(409, 'CONFLICT', message); }
}
/** Request is well-formed but violates a business rule (e.g. illegal status transition). */
export class BusinessRuleError extends AppError {
  constructor(message: string) { super(422, 'BUSINESS_RULE_VIOLATION', message); }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  // Malformed JSON body
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    return;
  }
  // PostgreSQL constraint errors
  switch (err?.code) {
    case '23505': res.status(409).json({ error: { code: 'CONFLICT', message: 'Duplicate value violates a unique constraint', details: err.detail } }); return;
    case '23503': res.status(422).json({ error: { code: 'INVALID_REFERENCE', message: 'Referenced record does not exist or is still in use', details: err.detail } }); return;
    case '23514': case '22P02': case '22003':
      res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Value rejected by the database', details: err.detail ?? err.message } }); return;
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
