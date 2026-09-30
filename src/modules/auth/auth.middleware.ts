import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { ForbiddenError, UnauthorizedError } from '../../utils/errors';
import { verifyAccessToken } from '../../utils/jwt';
import * as users from '../users/user.repository';
import { toPublicUser, type UserRole } from '../users/user.model';

/**
 * Verifies `Authorization: Bearer <jwt>`, loads the user from the DB (so deactivated
 * users or changed roles take effect immediately) and attaches it as `req.user`.
 */
export const authenticate = (): RequestHandler => async (req, _res, next) => {
  try {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedError('Authentication token missing');

    let payload;
    try {
      payload = verifyAccessToken(match[1]);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) throw new UnauthorizedError('Token expired');
      throw new UnauthorizedError('Invalid token');
    }

    const user = await users.findById(payload.sub).catch((err) => {
      // A non-uuid sub is an invalid token, not a server fault.
      if ((err as { code?: string }).code === '22P02') return null;
      throw err;
    });
    if (!user || !user.is_active || user.role !== payload.role) {
      throw new UnauthorizedError('Invalid token');
    }

    req.user = toPublicUser(user);
    next();
  } catch (err) {
    next(err);
  }
};

/** Use after authenticate(). Roles are a plain allow-list so richer permissions can replace it later. */
export const authorizeRoles =
  (...allowed: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!allowed.includes(req.user.role)) return next(new ForbiddenError());
    next();
  };
