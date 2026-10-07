import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError, UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './push.service';

const self = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

// The shape of the browser's PushSubscription.toJSON().
const subscribeSchema = z.object({
  endpoint: z.url().startsWith('https://', 'Endpoint must be https').max(2048),
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2048) });

export const publicKey = (_req: Request, res: Response) => {
  const key = service.getPublicKey();
  if (!key) throw new AppError(503, 'Push notifications are not configured');
  res.json({ publicKey: key });
};
export const subscribe = async (req: Request, res: Response) => {
  const body = parse(subscribeSchema, req.body);
  await service.subscribe(self(req), { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth }, req.get('user-agent') ?? null);
  res.status(201).json({ success: true });
};
export const unsubscribe = async (req: Request, res: Response) => {
  const { endpoint } = parse(unsubscribeSchema, req.body);
  res.json({ success: true, removed: await service.unsubscribe(self(req), endpoint) });
};
