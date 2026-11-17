import * as repo from './report.repository';
import { csvDocument, excelCompatibleTsv, type ExportCell } from './export.policy';
import { reportMeta, type LeadReportRow, type ReportFilters, type ReportScope } from './report.model';

const breakdowns = async (filters: ReportFilters, scope: ReportScope) => {
  const names = ['status', 'source', 'executive', 'manager', 'project', 'property', 'transactionType', 'propertyCategory', 'location', 'priceBand'] as const;
  const values = await Promise.all(names.map((name) => repo.breakdown(filters, scope, name)));
  return Object.fromEntries(names.map((name, index) => [`by${name[0].toUpperCase()}${name.slice(1)}`, values[index]]));
};

export async function overview(filters: ReportFilters, scope: ReportScope) {
  const [summary, grouped] = await Promise.all([repo.summary(filters, scope), breakdowns(filters, scope)]);
  return { data: { summary, breakdowns: grouped }, meta: reportMeta(filters) };
}

export async function leads(filters: ReportFilters, scope: ReportScope) {
  const [summary, rows] = await Promise.all([repo.summary(filters, scope), repo.listLeadReportRows(filters, scope)]);
  return { data: { summary, rows }, meta: { ...reportMeta(filters), pagination: { limit: filters.limit, offset: filters.offset, returned: rows.length } } };
}

export async function executives(filters: ReportFilters, scope: ReportScope) {
  const [rows, grouped] = await Promise.all([repo.executiveMetrics(filters, scope), breakdowns(filters, scope)]);
  return { data: { rows, breakdowns: grouped, historicalAssignmentData: true }, meta: reportMeta(filters) };
}

export async function managers(filters: ReportFilters, scope: ReportScope) {
  const [rows, grouped] = await Promise.all([repo.managerMetrics(filters, scope), breakdowns(filters, scope)]);
  return { data: { rows, breakdowns: grouped }, meta: reportMeta(filters) };
}

export async function sources(filters: ReportFilters, scope: ReportScope) {
  const [bySource, byStatus, byTransactionType, byPropertyCategory] = await Promise.all([
    repo.breakdown(filters, scope, 'source'),
    repo.breakdown(filters, scope, 'status'),
    repo.breakdown(filters, scope, 'transactionType'),
    repo.breakdown(filters, scope, 'propertyCategory'),
  ]);
  return { data: { bySource, byStatus, byTransactionType, byPropertyCategory }, meta: reportMeta(filters) };
}

export async function properties(filters: ReportFilters, scope: ReportScope) {
  const [rows, grouped] = await Promise.all([repo.propertyMetrics(filters, scope), breakdowns(filters, scope)]);
  return { data: { rows, breakdowns: grouped }, meta: reportMeta(filters) };
}

export async function transactions(filters: ReportFilters, scope: ReportScope) {
  const [byTransactionType, byPropertyCategory, byLocation, byPriceBand, byStatus, bySource] = await Promise.all([
    repo.breakdown(filters, scope, 'transactionType'), repo.breakdown(filters, scope, 'propertyCategory'), repo.breakdown(filters, scope, 'location'),
    repo.breakdown(filters, scope, 'priceBand'), repo.breakdown(filters, scope, 'status'), repo.breakdown(filters, scope, 'source'),
  ]);
  return { data: { byTransactionType, byPropertyCategory, byLocation, byPriceBand, byStatus, bySource }, meta: reportMeta(filters) };
}

export async function followUps(filters: ReportFilters, scope: ReportScope) {
  const [summary, byExecutive, byManager] = await Promise.all([repo.followUpMetrics(filters, scope), repo.breakdown(filters, scope, 'executive'), repo.breakdown(filters, scope, 'manager')]);
  return { data: { summary, byExecutive, byManager, limitations: ['Follow-up completion is unavailable because the current schema stores only the next follow-up, not completion events.'] }, meta: reportMeta(filters) };
}

const exportHeaders = ['Lead No', 'Created At', 'Status', 'Source', 'Executive', 'Manager', 'Project', 'Property', 'Transaction Type', 'Property Category', 'Location', 'Price Band', 'Follow-up At'];
const exportValues = (row: LeadReportRow): ExportCell[] => [row.leadNo, row.createdAt, row.status, row.source, row.assignedExecutiveName, row.managerName, row.projectName, row.propertyName, row.transactionType, row.propertyCategory, row.location, row.priceBand, row.followUpAt];

export async function exportLeadRows(filters: ReportFilters, scope: ReportScope) {
  const rows = await repo.listLeadReportRows(filters, scope, true);
  const values = rows.map(exportValues);
  return { rows, csv: csvDocument(exportHeaders, values), excel: excelCompatibleTsv(exportHeaders, values) };
}
