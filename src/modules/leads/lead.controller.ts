import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './lead.service';
import { idParam, listLeadsQuery, tzQuery } from './lead.validation';

const id = (req: Request) => parse(idParam, req.params).id;
/** Optional `?tz=` (IANA zone) that decides where "today" is for follow-up states. */
const tz = (req: Request) => parse(tzQuery, req.query).tz;
const self = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

// ---- admin: all leads ----
export const adminList = async (req: Request, res: Response) => {
  res.json(await service.listLeads({ ...parse(listLeadsQuery, req.query), viewerId: self(req) }));
};
export const adminGet = async (req: Request, res: Response) => {
  res.json(await service.getLeadDetail(id(req), undefined, undefined, self(req), tz(req)));
};
export const adminCreate = async (req: Request, res: Response) => {
  const { created, lead, notice } = await service.createLead(req.body, self(req));
  res.status(created ? 201 : 200).json(notice ? { ...lead, notice } : lead);
};
// ---- manager: add a lead and give it to an executive of their teams in one step ----
export const managerCreate = async (req: Request, res: Response) => {
  const { executiveId, ...input } = req.body;
  const managerId = self(req);
  await service.assertAssignable(executiveId, managerId); // before anything is saved
  const { created, lead, notice } = await service.createLead({ ...input, assignTo: { executiveId, byId: managerId } }, managerId);
  res.status(created ? 201 : 200).json(notice ? { ...lead, notice } : lead);
};
export const adminSetStatus = async (req: Request, res: Response) => {
  res.json(await service.updateStatus(id(req), req.body.status, undefined, self(req)));
};

// ---- executive: only own leads (ownerId is always the token's user, never client-supplied) ----
export const myList = async (req: Request, res: Response) => {
  const q = parse(listLeadsQuery, req.query);
  res.json(await service.listLeads({ ...q, executiveId: self(req), forExecutive: true, viewerId: self(req) }));
};
export const myGet = async (req: Request, res: Response) => {
  res.json(await service.getLeadDetail(id(req), self(req), undefined, self(req), tz(req)));
};
export const mySummary = async (req: Request, res: Response) => {
  res.json(await service.executiveSummary(self(req)));
};
export const mySetStatus = async (req: Request, res: Response) => {
  res.json(await service.updateStatus(id(req), req.body.status, self(req), self(req)));
};

// ---- admin + manager: give a lead to a sales executive (the actor comes from the token) ----
export const assign = async (req: Request, res: Response) => {
  if (!req.user || (req.user.role !== 'ADMIN' && req.user.role !== 'MANAGER')) throw new UnauthorizedError();
  res.json(await service.assignLead(id(req), req.body.executiveId, { id: req.user.id, role: req.user.role }));
};

// ---- manager: the leads of the teams they lead, plus unassigned leads ----
export const managerList = async (req: Request, res: Response) => {
  res.json(await service.listLeads({ ...parse(listLeadsQuery, req.query), managerId: self(req), viewerId: self(req) }));
};
export const managerGet = async (req: Request, res: Response) => {
  res.json(await service.getLeadDetail(id(req), undefined, self(req), self(req), tz(req)));
};

// ---- any role, in their own portal: mark / unmark a lead as important FOR THE LOGGED-IN USER ----
const actor = (req: Request) => {
  if (!req.user) throw new UnauthorizedError();
  return { id: req.user.id, role: req.user.role };
};
export const markImportant = async (req: Request, res: Response) => {
  res.json(await service.setImportant(id(req), actor(req), true));
};
export const unmarkImportant = async (req: Request, res: Response) => {
  res.json(await service.setImportant(id(req), actor(req), false));
};

// ---- any role, in their own portal: set / change / clear the follow-up of a lead they can see ----
export const setFollowUp = async (req: Request, res: Response) => {
  res.json(await service.setFollowUp(id(req), actor(req), req.body, tz(req)));
};
export const clearFollowUp = async (req: Request, res: Response) => {
  res.json(await service.setFollowUp(id(req), actor(req), { followUpAt: null }, tz(req)));
};
