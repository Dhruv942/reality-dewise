import { withTransaction } from '../../database/transaction';
import { AppError, NotFoundError } from '../../utils/errors';
import { canTransitionInventory, classifyPriceBand } from '../catalog/catalog.policy';
import * as repo from './inventory.repository';
import { toInventoryDto } from './inventory.model';

const get = async (id: string) => {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('Inventory not found');
  return row;
};

const activeProperty = async (tx: Parameters<Parameters<typeof withTransaction>[0]>[0], propertyId: string) => {
  const property = await repo.lockProperty(tx, propertyId);
  if (!property) throw new NotFoundError('Property not found');
  if (!property.is_active || property.archived_at) throw new AppError(409, 'Property is archived or inactive');
  if (property.project_id) {
    const project = await repo.projectStatus(tx, property.project_id);
    if (!project) throw new AppError(409, 'Property project is missing');
    if (project.status !== 'ACTIVE') throw new AppError(409, 'Project is archived');
  }
  return property;
};

export const list = async (f: Parameters<typeof repo.list>[0]) => (await repo.list(f)).map(toInventoryDto);
export const details = async (id: string) => toInventoryDto(await get(id));

export async function create(input: { propertyId: string; name: string; description?: string | null; location?: string | null; transactionType?: any; propertyType?: any; minPrice?: number | null; maxPrice?: number | null; currency?: string; availableFrom?: string | null; createdBy: string }) {
  const id = await withTransaction(async (tx) => {
    const property = await activeProperty(tx, input.propertyId);
    const min = input.minPrice ?? null;
    const max = input.maxPrice ?? null;
    return repo.insert(tx, { ...input, transactionType: input.transactionType ?? property.transaction_type, propertyType: input.propertyType ?? property.property_type, currency: input.currency ?? 'INR', minPrice: min, maxPrice: max, priceBand: classifyPriceBand(min, max), createdBy: input.createdBy });
  });
  return details(id);
}

export async function update(id: string, input: { name?: string; description?: string | null; location?: string | null; transactionType?: any; propertyType?: any; minPrice?: number | null; maxPrice?: number | null; currency?: string; availableFrom?: string | null }) {
  const current = await get(id);
  const min = input.minPrice !== undefined ? input.minPrice : (current.min_price === null ? null : Number(current.min_price));
  const max = input.maxPrice !== undefined ? input.maxPrice : (current.max_price === null ? null : Number(current.max_price));
  await repo.update(id, { name: input.name, description: input.description, location: input.location, transaction_type: input.transactionType, property_type: input.propertyType, min_price: input.minPrice, max_price: input.maxPrice, currency: input.currency, available_from: input.availableFrom, price_band: classifyPriceBand(min, max) });
  return details(id);
}

export async function setStatus(id: string, status: any) {
  const current = await get(id);
  if (!canTransitionInventory(current.status, status)) throw new AppError(409, `Cannot change inventory status from ${current.status} to ${status}`);
  await repo.setStatus(id, status, status === 'INACTIVE' ? new Date() : status === 'AVAILABLE' ? null : current.archived_at);
  return details(id);
}

export const archive = (id: string) => setStatus(id, 'INACTIVE');
