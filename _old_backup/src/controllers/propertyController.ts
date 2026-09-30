import { Request, Response } from 'express';
import { propertyService } from '../services/crudServices';
import { createPropertySchema, propertyListQuerySchema, updatePropertySchema } from '../validators';

export async function handleCreateProperty(req: Request, res: Response) {
  const body = createPropertySchema.parse(req.body);
  const property = await propertyService.create({
    ...body,
    bhk: body.bhk ?? undefined,
    areaSqft: body.areaSqft ?? undefined,
  });
  res.status(201).json(property);
}

export async function handleListProperties(req: Request, res: Response) {
  const query = propertyListQuerySchema.parse(req.query);
  const properties = await propertyService.list({
    projectId: query.projectId,
    bhk: query.bhk,
    availability: query.availability,
    maxPrice: query.maxPrice,
  });
  res.json({ data: properties });
}

export async function handleGetProperty(req: Request, res: Response) {
  const id = Number(req.params.id);
  const property = await propertyService.get(id);
  res.json(property);
}

export async function handleUpdateProperty(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updatePropertySchema.parse(req.body);
  const property = await propertyService.update(id, body);
  res.json(property);
}

export async function handleDeleteProperty(req: Request, res: Response) {
  const id = Number(req.params.id);
  await propertyService.remove(id);
  res.status(204).send();
}
