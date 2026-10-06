import type { Request, Response } from 'express';
import { parse } from '../../utils/validate';
import * as service from './customer.service';
import { idParam, listCustomersQuery } from './customer.validation';

export const list = async (req: Request, res: Response) => {
  res.json(await service.listCustomers(parse(listCustomersQuery, req.query)));
};
export const get = async (req: Request, res: Response) => {
  res.json(await service.getCustomerDetails(parse(idParam, req.params).id, req.user?.id));
};
export const update = async (req: Request, res: Response) => {
  res.json(await service.updateCustomer(parse(idParam, req.params).id, req.body));
};
