import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * Limits FAILED login attempts per client IP (successful logins are not counted).
 * Behind a reverse proxy set TRUST_PROXY so the real client IP is used.
 */
export const createLoginLimiter = (max: number = env.LOGIN_RATE_LIMIT_MAX) =>
  rateLimit({
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit: max,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, message: 'Too many failed login attempts, please try again later' });
    },
  });
