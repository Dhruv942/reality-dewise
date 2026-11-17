import { Router, type RequestHandler } from "express";
import { create99acresLimiter } from "../../middleware/rateLimit";
import { AppError } from "../../utils/errors";
import * as leadService from "../leads/lead.service";
import { map99acresPayload } from "./99acres.mapper";

const requireJson: RequestHandler = (req, res, next) => {
  if (!req.is("application/json")) {
    res
      .status(415)
      .json({
        success: false,
        message: "Content-Type must be application/json",
      });
    return;
  }
  next();
};

export const create99acresRouter = (rateLimitMax?: number) => {
  const router = Router();
  router.use(create99acresLimiter(rateLimitMax));
  router.post("/leads", requireJson, async (req, res, next) => {
    try {
      const input = map99acresPayload(req.body);
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
