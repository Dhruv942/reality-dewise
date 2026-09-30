import { Router } from 'express';
import { handleGetDashboardSummary } from '../controllers/dashboardController';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', handleGetDashboardSummary);
