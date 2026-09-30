import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import * as authService from './auth.service';
import type { UserRole } from '../users/user.model';
import type { LoginInput } from './auth.validation';

export const loginAs =
  (role: UserRole) =>
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body as LoginInput;
    res.json(await authService.login(role, email, password));
  };

export const me = (req: Request, res: Response): void => {
  if (!req.user) throw new UnauthorizedError();
  res.json(req.user);
};
