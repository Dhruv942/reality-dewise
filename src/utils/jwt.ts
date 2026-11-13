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

/**
 * A refresh token only ever buys a new access token (POST /auth/refresh); it is useless as a bearer token.
 * It is stateless like the access token and is re-checked against the user's row every time it is used, so
 * deactivating the account or changing its password ends it. Its expiry is absolute: renewing never extends it.
 */
export const signRefreshToken = (payload: AccessTokenPayload, expiresAt?: number): string =>
  jwt.sign(
    expiresAt === undefined ? { role: payload.role, typ: 'refresh' } : { role: payload.role, typ: 'refresh', exp: expiresAt },
    env.JWT_SECRET,
    {
      subject: payload.sub,
      algorithm: ALGORITHM,
      ...(expiresAt === undefined ? { expiresIn: env.REFRESH_EXPIRES_IN as SignOptions['expiresIn'] } : {}),
    },
  );

export function verifyRefreshToken(token: string): VerifiedAccessToken {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  if (typeof decoded === 'string' || decoded.typ !== 'refresh' || typeof decoded.sub !== 'string' || typeof decoded.role !== 'string' || typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
    throw new jwt.JsonWebTokenError('invalid payload');
  }
  return { sub: decoded.sub, role: decoded.role as UserRole, iat: decoded.iat, exp: decoded.exp };
}

/** Throws jsonwebtoken's TokenExpiredError / JsonWebTokenError on failure. */
export function verifyAccessToken(token: string): VerifiedAccessToken {
  const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: [ALGORITHM] });
  // A refresh token is not an access token.
  if (typeof decoded === 'string' || decoded.typ !== undefined || typeof decoded.sub !== 'string' || typeof decoded.role !== 'string' || typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
    throw new jwt.JsonWebTokenError('invalid payload');
  }
  return { sub: decoded.sub, role: decoded.role as UserRole, iat: decoded.iat, exp: decoded.exp };
}
