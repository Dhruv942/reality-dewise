import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './inventory.controller';
import { createInventorySchema, statusSchema, updateInventorySchema } from './inventory.validation';

export const inventoryRouter = Router();
inventoryRouter.get('/', c.list);
inventoryRouter.post('/', validateBody(createInventorySchema), c.create);
inventoryRouter.get('/:id', c.get);
inventoryRouter.patch('/:id', validateBody(updateInventorySchema), c.update);
inventoryRouter.post('/:id/archive', c.archive);
inventoryRouter.post('/:id/status', validateBody(statusSchema), c.status);
