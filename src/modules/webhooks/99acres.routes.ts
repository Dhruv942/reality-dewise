import { env } from '../../config/env';
import { create99acresLimiter } from '../../middleware/rateLimit';
import { map99acresPayload } from './99acres.mapper';
import { createPortalWebhookRouter } from './portal-webhook.router';

export const create99acresRouter = (rateLimitMax?: number) =>
  createPortalWebhookRouter({ source: '99ACRES', limiter: create99acresLimiter(rateLimitMax), map: map99acresPayload, secret: env.ACRES99_WEBHOOK_SECRET });
