import { InvalidCredentialsError } from '../../utils/errors';
import { getDummyHash, verifyPassword } from '../../utils/password';
import { signAccessToken } from '../../utils/jwt';
import * as users from '../users/user.repository';
import { toPublicUser, type PublicUser, type UserRole } from '../users/user.model';

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

/**
 * Authenticates a user for a specific role portal. Unknown email/username, wrong password,
 * inactive account and wrong role all yield the same error so nothing is leaked.
 */
export async function login(
  role: UserRole,
  who: { email?: string; username?: string },
  password: string,
): Promise<LoginResult> {
  const user = who.email ? await users.findByEmail(who.email) : await users.findByUsername(who.username ?? '');

  // Always run one hash verification so response time doesn't reveal whether the email exists.
  const passwordOk = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password);

  if (!user || !passwordOk || !user.is_active || user.role !== role) {
    throw new InvalidCredentialsError();
  }

  return {
    accessToken: signAccessToken({ sub: user.id, role: user.role }),
    user: toPublicUser(user),
  };
}
