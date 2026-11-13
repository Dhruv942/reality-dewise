import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './note.service';
import { idParam, listNotesQuery } from './note.validation';

const self = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};
const id = (req: Request) => parse(idParam, req.params).id;

export const list = async (req: Request, res: Response) => {
  res.json(await service.listMine(self(req), parse(listNotesQuery, req.query)));
};
export const get = async (req: Request, res: Response) => {
  res.json(await service.getMine(self(req), id(req)));
};
export const create = async (req: Request, res: Response) => {
  res.status(201).json(await service.createMine(self(req), req.body));
};
export const update = async (req: Request, res: Response) => {
  res.json(await service.updateMine(self(req), id(req), req.body));
};
export const remove = async (req: Request, res: Response) => {
  res.json(await service.deleteMine(self(req), id(req)));
};
