import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './property.controller';
import { setExecutivesSchema, statusSchema, updatePropertySchema } from './property.validation';
import * as mappingController from '../property-mappings/property-mapping.controller';

/** No POST: properties are created automatically the first time a lead names them. */
export const propertyRouter = Router();

propertyRouter.get('/', c.list);
propertyRouter.get('/:id', c.get);
propertyRouter.patch('/:id', validateBody(updatePropertySchema), c.update);
propertyRouter.patch('/:id/status', validateBody(statusSchema), c.setStatus);
propertyRouter.post('/:id/archive', c.archive);
propertyRouter.get('/:id/mappings', mappingController.forProperty);
propertyRouter.put('/:id/executives', validateBody(setExecutivesSchema), c.setExecutives);
propertyRouter.get('/:id/assignment-history', c.history);

/** A manager sees every property and edits only their own executives' part of its list. */
export const managerPropertyRouter = Router();
managerPropertyRouter.get('/', c.list);
managerPropertyRouter.get('/:id', c.get);
managerPropertyRouter.put('/:id/executives', validateBody(setExecutivesSchema), c.managerSetExecutives);
