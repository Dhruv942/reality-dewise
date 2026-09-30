import { Router } from 'express';
import { handleGetCustomer, handleListCustomers } from '../controllers/customerController';

export const customerRouter = Router();

customerRouter.get('/', handleListCustomers);
customerRouter.get('/:id', handleGetCustomer);
