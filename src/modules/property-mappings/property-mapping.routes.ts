import { Router } from 'express';
import { validateBody } from '../../middleware/validate';
import * as c from './property-mapping.controller';
import { createMappingSchema, updateMappingSchema } from './property-mapping.validation';

export const propertyMappingRouter = Router();
propertyMappingRouter.get('/', c.list);
propertyMappingRouter.post('/', validateBody(createMappingSchema), c.create);
propertyMappingRouter.get('/:id', c.get);
propertyMappingRouter.patch('/:id', validateBody(updateMappingSchema), c.update);
propertyMappingRouter.delete('/:id', c.deactivate);
