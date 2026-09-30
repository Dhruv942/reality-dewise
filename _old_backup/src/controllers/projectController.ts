import { Request, Response } from 'express';
import { projectService } from '../services/crudServices';
import { createProjectSchema, updateProjectSchema } from '../validators';

export async function handleCreateProject(req: Request, res: Response) {
  const body = createProjectSchema.parse(req.body);
  const project = await projectService.create({
    ...body,
    location: body.location ?? undefined,
    teamId: body.teamId ?? undefined,
    slaMinutes: body.slaMinutes ?? undefined,
  });
  res.status(201).json(project);
}

export async function handleListProjects(req: Request, res: Response) {
  const teamId = req.query.teamId ? Number(req.query.teamId) : undefined;
  const status = req.query.status ? String(req.query.status) : undefined;
  const projects = await projectService.list({ teamId, status });
  res.json({ data: projects });
}

export async function handleGetProject(req: Request, res: Response) {
  const id = Number(req.params.id);
  const project = await projectService.get(id);
  res.json(project);
}

export async function handleUpdateProject(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updateProjectSchema.parse(req.body);
  const project = await projectService.update(id, {
    ...body,
    location: body.location ?? undefined,
  });
  res.json(project);
}

export async function handleDeleteProject(req: Request, res: Response) {
  const id = Number(req.params.id);
  await projectService.remove(id);
  res.status(204).send();
}
