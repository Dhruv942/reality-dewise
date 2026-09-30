import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './customer.controller';
import { updateCustomerSchema } from './customer.validation';

export const customerRouter = Router();

customerRouter.get('/', c.list);
customerRouter.get('/:id', c.get);
customerRouter.patch('/:id', validateBody(updateCustomerSchema), c.update);
