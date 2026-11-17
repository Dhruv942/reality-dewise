import { Router, type RequestHandler } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from './auth.middleware';
import { loginAs, loginAuto, me, refresh } from './auth.controller';
import { loginSchema, refreshSchema } from './auth.validation';
import { handleZohoOAuthCallback } from './zoho-oauth-callback';

export function createAuthRouter(loginLimiter: RequestHandler): Router {
  const router = Router();
  // The portal sign-in: email + password only. The response carries the user's actual role.
  router.post('/login', loginLimiter, validateBody(loginSchema), loginAuto);
  router.post('/admin/login', loginLimiter, validateBody(loginSchema), loginAs('ADMIN'));
  router.post('/manager/login', loginLimiter, validateBody(loginSchema), loginAs('MANAGER'));
  // Sales executives and executive managers (role SALES) both sign in here.
  router.post('/executive/login', loginLimiter, validateBody(loginSchema), loginAs('SALES'));
  router.post('/refresh', loginLimiter, validateBody(refreshSchema), refresh);
  router.get('/zoho/callback', handleZohoOAuthCallback);
  router.get('/me', authenticate(), me);
  return router;
}
