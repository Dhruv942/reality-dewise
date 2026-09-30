import { Request, Response } from 'express';
import { getDashboardSummary } from '../services/dashboardService';
import { dashboardSummaryQuerySchema } from '../validators';

export async function handleGetDashboardSummary(req: Request, res: Response) {
  const filters = dashboardSummaryQuerySchema.parse(req.query);
  const summary = await getDashboardSummary(filters);
  res.json({ data: summary });
}
