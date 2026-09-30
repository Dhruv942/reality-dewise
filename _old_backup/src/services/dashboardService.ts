import { pool } from '../db/pool';
import { LeadFilters } from '../repositories/leadFilters';
import { dashboardRepository } from '../repositories/dashboardRepository';

export const getDashboardSummary = (filters: LeadFilters) => dashboardRepository.summary(pool, filters);
