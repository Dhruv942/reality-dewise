import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import type { UserRole } from '../modules/users/user.model';

/** Only what is needed to identify the caller. Everything else is loaded from the DB. */
export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export interface VerifiedAccessToken extends AccessTokenPayload {
  /** Issued-at, seconds since epoch. */
  iat: number;
  /** Expiry, seconds since epoch. */
  exp: number;
}

const ALGORITHM = 'HS256';

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign({ role: payload.role }, env.JWT_SECRET, {
    subject: payload.sub,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
    algorithm: ALGORITHM,
  });

/** Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError on failure. */
export function verifyAccessToken(token: string): VerifiedAccessToken {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.role !== 'string' || typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
    throw new jwt.JsonWebTokenError('invalid payload');
  }
  return { sub: decoded.sub, role: decoded.role as UserRole, iat: decoded.iat, exp: decoded.exp };
}
