import { Router } from 'express';
import {
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handleUpdateProject,
} from '../controllers/projectController';

export const projectRouter = Router();

projectRouter.post('/', handleCreateProject);
projectRouter.get('/', handleListProjects);
projectRouter.get('/:id', handleGetProject);
projectRouter.patch('/:id', handleUpdateProject);
projectRouter.delete('/:id', handleDeleteProject);
