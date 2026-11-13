import { Router, type RequestHandler } from 'express';
import { createMagicbricksLimiter } from '../../middleware/rateLimit';
import { AppError } from '../../utils/errors';
import * as leadService from '../leads/lead.service';
import { mapMagicbricksPayload } from './magicbricks.mapper';

const requireJson: RequestHandler = (req, res, next) => {
  if (!req.is('application/json')) {
    res.status(415).json({ success: false, message: 'Content-Type must be application/json' });
    return;
  }
  next();
};

/** Public by design: Magicbricks supplies no credentials. Rate limiting is only an abuse-control measure. */
export const createMagicbricksRouter = (rateLimitMax?: number) => {
  const router = Router();
  router.use(createMagicbricksLimiter(rateLimitMax));
  router.post('/leads', requireJson, async (req, res, next) => {
    try {
      const input = mapMagicbricksPayload(req.body);
      const result = await leadService.createLead(input);
      res.status(result.created ? 201 : 200).json({
        success: true,
        duplicate: !result.created,
        leadId: result.lead.id,
        lead: result.lead,
      });
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
        return;
      }
      next(error);
    }
  });
  return router;
};
