import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from './auth.middleware';
import { loginAs, me } from './auth.controller';
import { loginSchema } from './auth.validation';

export function createAuthRouter(loginLimiter: RequestHandler): Router {
  const router = Router();
  router.post('/admin/login', loginLimiter, validateBody(loginSchema), loginAs('ADMIN'));
  router.post('/manager/login', loginLimiter, validateBody(loginSchema), loginAs('MANAGER'));
  // Sales executives and executive managers (role SALES) both sign in here.
  router.post('/executive/login', loginLimiter, validateBody(loginSchema), loginAs('SALES'));
  router.get('/me', authenticate(), me);
  return router;
}
