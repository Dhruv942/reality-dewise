import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import * as service from './settings.service';

export const getAssignmentRule = async (_req: Request, res: Response) => {
  res.json(await service.getAssignmentRuleSetting());
};
export const updateAssignmentRule = async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  res.json(await service.setAssignmentRule(req.body.rule, req.user.id));
};

export const getLeadTimeout = async (_req: Request, res: Response) => {
  res.json(await service.getLeadTimeoutSetting());
};
export const updateLeadTimeout = async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  res.json(await service.setLeadTimeoutMinutes(req.body.minutes, req.user.id));
};
