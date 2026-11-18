import { timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { AppError, UnauthorizedError } from '../../utils/errors';
import * as leadService from '../leads/lead.service';
import type { NewLeadInput } from '../leads/lead.service';
import * as events from './webhook-event.repository';

const requireJson: RequestHandler = (req, res, next) => {
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, message: 'Content-Type must be application/json' });
    return;
  }
  next();
};

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Accepts the secret as `x-webhook-secret`, `Authorization: Bearer` or `?token=` (some portals can only call a URL). */
const requireSecret = (secret: string | undefined): RequestHandler => (req, _res, next) => {
  if (!secret) return next();
  const header = req.get('x-webhook-secret') ?? /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '')?.[1];
  const query = typeof req.query.token === 'string' ? req.query.token : undefined;
  const given = header ?? query;
  if (!given || !same(given, secret)) return next(new UnauthorizedError('Invalid webhook credentials'));
  next();
};

interface PortalWebhook {
  source: string;
  limiter: RequestHandler;
  map: (payload: unknown) => NewLeadInput;
  secret?: string;
}

/**
 * Shared by every portal. The raw body is stored first, so a payload the mapper rejects is kept for review
 * instead of vanishing; the stored row then records the outcome (lead, duplicate or the error).
 */
export function createPortalWebhookRouter({ source, limiter, map, secret }: PortalWebhook): Router {
  const router = Router();
  router.use(limiter);
  router.post('/leads', requireSecret(secret), requireJson, async (req, res, next) => {
    const eventId = await events.record(source, req.body);
    try {
      const result = await leadService.createLead(map(req.body));
      await events.settle(eventId, result.created ? 'PROCESSED' : 'DUPLICATE', result.lead.id, null);
      res.status(result.created ? 201 : 200).json({
        success: true,
        duplicate: !result.created,
        leadId: result.lead.id,
        lead: result.lead,
      });
    } catch (error) {
      const detail = error instanceof AppError && error.details ? ` ${JSON.stringify(error.details)}` : '';
      await events.settle(eventId, 'FAILED', null, `${error instanceof Error ? error.message : 'unknown error'}${detail}`);
      next(error);
    }
  });
  return router;
}
