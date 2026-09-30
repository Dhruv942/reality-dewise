import { Router } from 'express';
import {
  handleCreateProperty,
  handleDeleteProperty,
  handleGetProperty,
  handleListProperties,
  handleUpdateProperty,
} from '../controllers/propertyController';

export const propertyRouter = Router();

propertyRouter.post('/', handleCreateProperty);
propertyRouter.get('/', handleListProperties);
propertyRouter.get('/:id', handleGetProperty);
propertyRouter.patch('/:id', handleUpdateProperty);
propertyRouter.delete('/:id', handleDeleteProperty);
