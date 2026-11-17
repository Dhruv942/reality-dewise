import { withTransaction } from '../../database/transaction';
import { AppError, NotFoundError } from '../../utils/errors';
import { normalizePropertyName } from '../property-matching/matching.policy';
import * as propertyRepo from '../properties/property.repository';
import * as repo from './property-mapping.repository';
import { toPropertyMappingDto } from './property-mapping.model';

const get = async (id: string) => {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('Property mapping not found');
  return row;
};
const property = async (id: string) => {
  const row = await propertyRepo.findById(id);
  if (!row) throw new NotFoundError('Property not found');
  return row;
};

export const list = async (f: Parameters<typeof repo.list>[0]) => (await repo.list(f)).map(toPropertyMappingDto);
export const details = async (id: string) => toPropertyMappingDto(await get(id));
export const forProperty = async (propertyId: string) => { await property(propertyId); return (await repo.listForProperty(propertyId)).map(toPropertyMappingDto); };

const normalizedFor = (name: string | null | undefined, fallback: string) => normalizePropertyName(name || fallback);

export async function create(input: { propertyId: string; portalSource: string; externalPropertyId?: string | null; externalPropertyName?: string | null; externalListingUrl?: string | null; actorId: string }) {
  const p = await property(input.propertyId);
  const id = await withTransaction((tx) => repo.insert(tx, { propertyId: p.id, source: input.portalSource, externalId: input.externalPropertyId ?? null, externalName: input.externalPropertyName ?? null, normalizedName: normalizedFor(input.externalPropertyName, p.name), url: input.externalListingUrl ?? null, actorId: input.actorId }));
  return details(id);
}

export async function update(id: string, input: { propertyId?: string; portalSource?: string; externalPropertyId?: string | null; externalPropertyName?: string | null; externalListingUrl?: string | null; isActive?: boolean; actorId: string }) {
  const current = await get(id);
  const p = await property(input.propertyId ?? current.property_id);
  await repo.update(id, { propertyId: input.propertyId, source: input.portalSource, externalId: input.externalPropertyId, externalName: input.externalPropertyName, normalizedName: normalizedFor(input.externalPropertyName, p.name), url: input.externalListingUrl, isActive: input.isActive, actorId: input.actorId });
  return details(id);
}

export async function deactivate(id: string, actorId: string) {
  await get(id);
  await repo.update(id, { isActive: false, actorId });
  return details(id);
}
