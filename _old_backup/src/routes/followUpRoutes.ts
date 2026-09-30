import { Router } from 'express';
import {
  handleCancelFollowUp,
  handleCompleteFollowUp,
  handleGetFollowUp,
  handleListFollowUps,
  handleRescheduleFollowUp,
} from '../controllers/followUpController';

export const followUpRouter = Router();

followUpRouter.get('/', handleListFollowUps);
followUpRouter.get('/:id', handleGetFollowUp);
followUpRouter.patch('/:id/complete', handleCompleteFollowUp);
followUpRouter.patch('/:id/reschedule', handleRescheduleFollowUp);
followUpRouter.patch('/:id/cancel', handleCancelFollowUp);
