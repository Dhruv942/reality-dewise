import { Request, Response } from 'express';
import { teamService } from '../services/crudServices';
import { createTeamSchema, updateTeamSchema } from '../validators';

export async function handleCreateTeam(req: Request, res: Response) {
  const body = createTeamSchema.parse(req.body);
  const team = await teamService.create(body);
  res.status(201).json(team);
}

export async function handleListTeams(req: Request, res: Response) {
  const teams = await teamService.list();
  res.json({ data: teams });
}

export async function handleGetTeam(req: Request, res: Response) {
  const id = Number(req.params.id);
  const team = await teamService.get(id);
  res.json(team);
}

export async function handleUpdateTeam(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updateTeamSchema.parse(req.body);
  const team = await teamService.update(id, body);
  res.json(team);
}

export async function handleDeleteTeam(req: Request, res: Response) {
  const id = Number(req.params.id);
  await teamService.remove(id);
  res.status(204).send();
}
