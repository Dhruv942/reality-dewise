import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { parse } from '../utils/validate';

/** Validates and replaces req.body with the parsed (trimmed/normalised) value. */
export const validateBody =
  (schema: ZodType): RequestHandler =>
  (req, _res, next) => {
    try {
      req.body = parse(schema, req.body ?? {});
      next();
    } catch (err) {
      next(err);
    }
  };
