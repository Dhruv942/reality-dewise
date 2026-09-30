import type { Request, Response } from 'express';
import { parse } from '../../utils/validate';
import * as service from './team.service';
import { idParam, listTeamsQuery, teamIdParam } from './team.validation';

export const list = async (req: Request, res: Response) => {
  res.json(await service.listTeams(parse(listTeamsQuery, req.query)));
};
export const get = async (req: Request, res: Response) => {
  res.json(await service.getTeamDetails(parse(idParam, req.params).id));
};
export const listExecutives = async (req: Request, res: Response) => {
  res.json(await service.getTeamExecutives(parse(teamIdParam, req.params).teamId));
};
export const create = async (req: Request, res: Response) => {
  res.status(201).json(await service.createTeam(req.body));
};
export const update = async (req: Request, res: Response) => {
  res.json(await service.updateTeam(parse(idParam, req.params).id, req.body));
};
export const setStatus = async (req: Request, res: Response) => {
  res.json(await service.setTeamStatus(parse(idParam, req.params).id, req.body.isActive));
};
