import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import { authenticate } from './auth.middleware';
import { loginAs, me } from './auth.controller';
import { loginSchema } from './auth.validation';

export const authRouter = Router();

authRouter.post('/admin/login', validateBody(loginSchema), loginAs('ADMIN'));
authRouter.post('/executive/login', validateBody(loginSchema), loginAs('EXECUTIVE'));
authRouter.get('/me', authenticate(), me);
