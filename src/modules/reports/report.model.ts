import type { PriceBand, PropertyType, TransactionType } from '../catalog/catalog.policy';
import type { PropertySource } from '../properties/property.model';
import type { LeadStatus } from '../leads/lead.model';

export type ReportFormat = 'json' | 'csv' | 'excel';

export interface ReportFilters {
  fromDate?: string;
  toDate?: string;
  managerId?: string;
  executiveId?: string;
  source?: PropertySource;
  status?: LeadStatus;
  projectId?: string;
  propertyId?: string;
  transactionType?: TransactionType;
  propertyCategory?: PropertyType;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
  priceBand?: PriceBand;
  tz: string;
  limit: number;
  offset: number;
  format: ReportFormat;
}

export interface ReportScope {
  role: 'ADMIN' | 'MANAGER' | 'SALES';
  managerId?: string;
  executiveId?: string;
}

export interface LeadReportRow {
  leadNo: number;
  leadId: string;
  createdAt: Date;
  status: LeadStatus;
  source: string;
  assignedExecutiveId: string | null;
  assignedExecutiveName: string | null;
  managerId: string | null;
  managerName: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  propertyId: string;
  propertyName: string;
  transactionType: TransactionType | null;
  propertyCategory: PropertyType | null;
  location: string | null;
  priceBand: PriceBand | null;
  followUpAt: Date | null;
}

export interface BreakdownRow {
  key: string | null;
  label: string;
  count: number;
}

export const reportMeta = (filters: ReportFilters) => ({
  appliedFilters: { ...filters, format: undefined },
  timezone: filters.tz,
  generatedAt: new Date().toISOString(),
});
