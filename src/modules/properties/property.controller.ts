import type { Request, Response } from 'express';
import { parse } from '../../utils/validate';
import * as service from './property.service';
import { historyQuery, idParam, listPropertiesQuery } from './property.validation';

const id = (req: Request) => parse(idParam, req.params).id;

export const list = async (req: Request, res: Response) => {
  res.json(await service.listProperties(parse(listPropertiesQuery, req.query)));
};
export const get = async (req: Request, res: Response) => {
  res.json(await service.getPropertyDetails(id(req)));
};
export const update = async (req: Request, res: Response) => {
  res.json(await service.updateProperty(id(req), req.body));
};
export const setStatus = async (req: Request, res: Response) => {
  res.json(await service.setPropertyStatus(id(req), req.body.isActive));
};
export const setExecutives = async (req: Request, res: Response) => {
  res.json(await service.setExecutives(id(req), req.body.executiveIds));
};
export const history = async (req: Request, res: Response) => {
  const q = parse(historyQuery, req.query);
  res.json(await service.getAssignmentHistory(id(req), q.limit, q.offset));
};
