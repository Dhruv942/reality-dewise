import { Router } from 'express';
import {
  handleCreateTeam,
  handleDeleteTeam,
  handleGetTeam,
  handleListTeams,
  handleUpdateTeam,
} from '../controllers/teamController';

export const teamRouter = Router();

teamRouter.post('/', handleCreateTeam);
teamRouter.get('/', handleListTeams);
teamRouter.get('/:id', handleGetTeam);
teamRouter.patch('/:id', handleUpdateTeam);
teamRouter.delete('/:id', handleDeleteTeam);
