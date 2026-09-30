import { Request, Response } from 'express';
import { customerService } from '../services/crudServices';
import { customerListQuerySchema } from '../validators';

export async function handleListCustomers(req: Request, res: Response) {
  const query = customerListQuerySchema.parse(req.query);
  const result = await customerService.list({ page: query.page, limit: query.limit }, query.search);
  res.json(result);
}

export async function handleGetCustomer(req: Request, res: Response) {
  const id = Number(req.params.id);
  const result = await customerService.get(id);
  res.json(result);
}
