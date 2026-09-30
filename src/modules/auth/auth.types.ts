import type { PublicUser } from '../users/user.model';

export type AuthenticatedUser = PublicUser;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
