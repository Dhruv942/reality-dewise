import { env } from '../../config/env';
import { createMagicbricksLimiter } from '../../middleware/rateLimit';
import { mapMagicbricksPayload } from './magicbricks.mapper';
import { createPortalWebhookRouter } from './portal-webhook.router';

/** Open unless MAGICBRICKS_WEBHOOK_SECRET is set: Magicbricks supplies no credentials of its own. */
export const createMagicbricksRouter = (rateLimitMax?: number) =>
  createPortalWebhookRouter({ source: 'MAGICBRICKS', limiter: createMagicbricksLimiter(rateLimitMax), map: mapMagicbricksPayload, secret: env.MAGICBRICKS_WEBHOOK_SECRET });
