import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './inventory.service';
import { createInventorySchema, idParam, listInventoryQuery, statusSchema, updateInventorySchema } from './inventory.validation';

const id = (req: Request) => parse(idParam, req.params).id;
export const list = async (req: Request, res: Response) => res.json(await service.list(parse(listInventoryQuery, req.query)));
export const create = async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  res.status(201).json(await service.create({ ...parse(createInventorySchema, req.body), createdBy: req.user.id }));
};
export const get = async (req: Request, res: Response) => res.json(await service.details(id(req)));
export const update = async (req: Request, res: Response) => res.json(await service.update(id(req), parse(updateInventorySchema, req.body)));
export const archive = async (req: Request, res: Response) => res.json(await service.archive(id(req)));
export const status = async (req: Request, res: Response) => res.json(await service.setStatus(id(req), parse(statusSchema, req.body).status));
