import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware';
import * as c from './push.controller';

/** /api/v1/push: any logged-in user manages only their own devices. */
export const pushRouter = Router();

pushRouter.use(authenticate());
pushRouter.get('/public-key', c.publicKey);
pushRouter.post('/subscriptions', c.subscribe);
pushRouter.delete('/subscriptions', c.unsubscribe);
