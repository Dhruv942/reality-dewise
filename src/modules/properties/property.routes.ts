import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './property.controller';
import { setExecutivesSchema, statusSchema, updatePropertySchema } from './property.validation';

/** No POST: properties are created automatically the first time a lead names them. */
export const propertyRouter = Router();

propertyRouter.get('/', c.list);
propertyRouter.get('/:id', c.get);
propertyRouter.patch('/:id', validateBody(updatePropertySchema), c.update);
propertyRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
propertyRouter.put('/:id/executives', validateBody(setExecutivesSchema), c.setExecutives);
propertyRouter.get('/:id/assignment-history', c.history);
