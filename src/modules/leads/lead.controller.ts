import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './lead.service';
import { idParam, listLeadsQuery } from './lead.validation';

const id = (req: Request) => parse(idParam, req.params).id;
const self = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

// ---- admin: all leads ----
export const adminList = async (req: Request, res: Response) => {
  res.json(await service.listLeads(parse(listLeadsQuery, req.query)));
};
export const adminGet = async (req: Request, res: Response) => {
  res.json(await service.getLead(id(req)));
};
export const adminCreate = async (req: Request, res: Response) => {
  const { created, lead } = await service.createLead(req.body);
  res.status(created ? 201 : 200).json(lead);
};
export const adminSetStatus = async (req: Request, res: Response) => {
  res.json(await service.updateStatus(id(req), req.body.status));
};

// ---- executive: only own leads (ownerId is always the token's user, never client-supplied) ----
export const myList = async (req: Request, res: Response) => {
  const q = parse(listLeadsQuery, req.query);
  res.json(await service.listLeads({ ...q, executiveId: self(req) }));
};
export const myGet = async (req: Request, res: Response) => {
  res.json(await service.getLead(id(req), self(req)));
};
export const mySetStatus = async (req: Request, res: Response) => {
  res.json(await service.updateStatus(id(req), req.body.status, self(req)));
};
