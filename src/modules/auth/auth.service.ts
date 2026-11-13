import { InvalidCredentialsError, UnauthorizedError } from '../../utils/errors';
import { getDummyHash, verifyPassword } from '../../utils/password';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import * as users from '../users/user.repository';
import { toPublicUser, type PublicUser, type UserRole } from '../users/user.model';

export interface LoginResult {
  accessToken: string;
  /** Renews the session through POST /auth/refresh until its absolute expiry. Keep it httpOnly, never in localStorage. */
  refreshToken: string;
  user: PublicUser;
}

/**
 * Authenticates a user. With `role` (the legacy per-portal endpoints) the account must have exactly that role;
 * without it (`POST /auth/login`) the role is whatever the database says it is. Unknown email/username, wrong
 * password, inactive account and wrong role all yield the same error so nothing is leaked.
 */
export async function login(
  role: UserRole | undefined,
  who: { email?: string; username?: string },
  password: string,
): Promise<LoginResult> {
  const user = who.email ? await users.findByEmail(who.email) : await users.findByUsername(who.username ?? '');

  // Always run one hash verification so response time doesn't reveal whether the email exists.
  const passwordOk = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password);

  if (!user || !passwordOk || !user.is_active || (role && user.role !== role)) {
    throw new InvalidCredentialsError();
  }

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: signRefreshToken({ sub: user.id, role: user.role }),
    user: toPublicUser(user),
  };
}

/**
 * Exchanges a valid refresh token for a new access token (and a new refresh token with the SAME absolute expiry,
 * so a session can never outlive REFRESH_EXPIRES_IN from the login). Everything is re-read from the database:
 * a deactivated or deleted user, a changed role or a password change after the token was issued ends the session.
 * Every failure is the same 401 so nothing is leaked.
 */
export async function refresh(refreshToken: string): Promise<LoginResult> {
  const invalid = () => new UnauthorizedError('Session expired, please log in again');
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid();
  }
  const user = await users.findById(payload.sub).catch((err) => {
    if ((err as { code?: string }).code === '22P02') return null;
    throw err;
  });
  if (!user || !user.is_active || user.deleted_at || user.role !== payload.role) throw invalid();
  if (user.password_changed_at && payload.iat <= Math.floor(user.password_changed_at.getTime() / 1000)) throw invalid();
  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    refreshToken: signRefreshToken({ sub: user.id, role: user.role }, payload.exp),
    user: toPublicUser(user),
  };
}
