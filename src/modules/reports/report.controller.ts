import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../utils/errors';
import { parseReportFilters } from './report.validation';
import * as service from './report.service';
import type { ReportScope } from './report.model';

const scope = (req: Request): ReportScope => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.role === 'ADMIN' ? { role: 'ADMIN' } : req.user.role === 'MANAGER' ? { role: 'MANAGER', managerId: req.user.id } : { role: 'SALES', executiveId: req.user.id };
};

async function respond(req: Request, res: Response, fn: (filters: ReturnType<typeof parseReportFilters>, scope: ReportScope) => Promise<unknown>) {
  const filters = parseReportFilters(req.query);
  if (filters.format === 'json') return res.json(await fn(filters, scope(req)));
  const exported = await service.exportLeadRows(filters, scope(req));
  const excel = filters.format === 'excel';
  res.status(200).set({
    'Content-Type': excel ? 'application/vnd.ms-excel; charset=utf-8' : 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="realtyadwise-report-${new Date().toISOString().slice(0, 10)}.${excel ? 'xls' : 'csv'}"`,
  }).send(excel ? exported.excel : exported.csv);
}

export const overview = (req: Request, res: Response) => respond(req, res, service.overview);
export const leads = (req: Request, res: Response) => respond(req, res, service.leads);
export const executives = (req: Request, res: Response) => respond(req, res, service.executives);
export const managers = (req: Request, res: Response) => respond(req, res, service.managers);
export const sources = (req: Request, res: Response) => respond(req, res, service.sources);
export const properties = (req: Request, res: Response) => respond(req, res, service.properties);
export const transactions = (req: Request, res: Response) => respond(req, res, service.transactions);
export const followUps = (req: Request, res: Response) => respond(req, res, service.followUps);
