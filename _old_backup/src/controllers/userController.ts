import { Request, Response } from 'express';
import { userService } from '../services/crudServices';
import { createUserSchema, updateUserSchema } from '../validators';

export async function handleCreateUser(req: Request, res: Response) {
  const body = createUserSchema.parse(req.body);
  const user = await userService.create({
    ...body,
    mobile: body.mobile ?? undefined,
    email: body.email ?? undefined,
    teamId: body.teamId ?? undefined,
  });
  res.status(201).json(user);
}

export async function handleListUsers(req: Request, res: Response) {
  const teamId = req.query.teamId ? Number(req.query.teamId) : undefined;
  const isActive = req.query.isActive !== undefined ? req.query.isActive === 'true' : undefined;
  const users = await userService.list({ teamId, isActive });
  res.json({ data: users });
}

export async function handleGetUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  const user = await userService.get(id);
  res.json(user);
}

export async function handleUpdateUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updateUserSchema.parse(req.body);
  const user = await userService.update(id, {
    ...body,
    mobile: body.mobile ?? undefined,
    email: body.email ?? undefined,
  });
  res.json(user);
}

export async function handleDeleteUser(req: Request, res: Response) {
  const id = Number(req.params.id);
  await userService.remove(id);
  res.status(204).send();
}
