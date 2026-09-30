import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../modules/users/user.model';

/** Only what is needed to identify the caller. Everything else is loaded from the DB. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

const ALGORITHM = 'HS256';

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign({ role: payload.role }, env.JWT_SECRET, {
    subject: payload.sub,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    algorithm: ALGORITHM,
  });

/** Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError on failure. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') {
    throw new jwt.JsonWebTokenError('invalid payload');
  }
  return { sub: decoded.sub, role: decoded.role as UserRole };
}
