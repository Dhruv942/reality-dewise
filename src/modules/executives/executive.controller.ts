import type { Request, Response } from 'express';
import { parse } from '../../utils/validate';
import * as service from './executive.service';
import { executiveIdParam, idParam, listExecutivesQuery } from './executive.validation';

export const list = async (req: Request, res: Response) => {
  res.json(await service.listExecutives(parse(listExecutivesQuery, req.query)));
};
export const get = async (req: Request, res: Response) => {
  res.json(await service.getExecutiveDetails(parse(idParam, req.params).id));
};
export const create = async (req: Request, res: Response) => {
  res.status(201).json(await service.createExecutive(req.body));
};
export const update = async (req: Request, res: Response) => {
  res.json(await service.updateExecutive(parse(idParam, req.params).id, req.body));
};
export const changePassword = async (req: Request, res: Response) => {
  await service.changePassword(parse(idParam, req.params).id, req.body.password);
  res.json({ success: true, message: 'Password updated' });
};
export const setStatus = async (req: Request, res: Response) => {
  res.json(await service.setStatus(parse(idParam, req.params).id, req.body.isActive));
};
export const remove = async (req: Request, res: Response) => {
  const executive = await service.deleteExecutive(parse(idParam, req.params).id);
  res.json({
    success: true,
    message: 'Executive was soft-deleted: the account is deactivated and hidden, history is preserved',
    executive,
  });
};
export const assignTeam = async (req: Request, res: Response) => {
  res.json(await service.assignTeam(parse(executiveIdParam, req.params).executiveId, req.body.teamId));
};
export const removeFromTeam = async (req: Request, res: Response) => {
  res.json(await service.removeFromTeam(parse(executiveIdParam, req.params).executiveId));
};
