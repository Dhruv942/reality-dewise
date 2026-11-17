import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './project.service';
import { createProjectSchema, idParam, projectListQuery, updateProjectSchema } from './project.validation';

const id = (req: Request) => parse(idParam, req.params).id;

export const list = async (req: Request, res: Response) => res.json(await service.list(parse(projectListQuery, req.query)));
export const create = async (req: Request, res: Response) => {
  if (!req.user) throw new UnauthorizedError();
  res.status(201).json(await service.create({ ...parse(createProjectSchema, req.body), createdBy: req.user.id }));
};
export const get = async (req: Request, res: Response) => res.json(await service.details(id(req)));
export const update = async (req: Request, res: Response) => res.json(await service.update(id(req), parse(updateProjectSchema, req.body)));
export const archive = async (req: Request, res: Response) => res.json(await service.archive(id(req)));
