import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './property-mapping.service';
import { createMappingSchema, idParam, listMappingQuery, updateMappingSchema } from './property-mapping.validation';

const self = (req: Request) => { if (!req.user) throw new UnauthorizedError(); return req.user.id; };
const id = (req: Request) => parse(idParam, req.params).id;
export const list = async (req: Request, res: Response) => res.json(await service.list(parse(listMappingQuery, req.query)));
export const create = async (req: Request, res: Response) => res.status(201).json(await service.create({ ...parse(createMappingSchema, req.body), actorId: self(req) }));
export const get = async (req: Request, res: Response) => res.json(await service.details(id(req)));
export const update = async (req: Request, res: Response) => res.json(await service.update(id(req), { ...parse(updateMappingSchema, req.body), actorId: self(req) }));
export const deactivate = async (req: Request, res: Response) => res.json(await service.deactivate(id(req), self(req)));
export const forProperty = async (req: Request, res: Response) => res.json(await service.forProperty(id(req)));
