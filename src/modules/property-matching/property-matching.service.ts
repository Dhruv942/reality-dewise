import type { Db } from '../../database/transaction';
import type { PropertySource } from '../properties/property.model';
import * as propertyRepo from '../properties/property.repository';
import * as mappingRepo from '../property-mappings/property-mapping.repository';
import { fuzzyCandidates, normalizePropertyName, type MatchCandidate } from './matching.policy';

export type PropertyMatchStatus = 'MATCHED' | 'UNMATCHED' | 'AMBIGUOUS' | 'CONFLICT';
export type PropertyMatchMethod = 'EXTERNAL_ID' | 'PORTAL_ALIAS' | 'NORMALIZED_NAME' | 'FUZZY_NAME' | 'UNMATCHED' | 'AMBIGUOUS' | 'CONFLICT';

export interface PropertyMatchInput {
  source: PropertySource;
  propertyName: string;
  externalPropertyId?: string | null;
  externalPropertyName?: string | null;
  externalPropertyUrl?: string | null;
}

export interface PropertyMatchResult {
  status: PropertyMatchStatus;
  method: PropertyMatchMethod;
  property: { id: string; name: string } | null;
  confidence: number | null;
  candidates: MatchCandidate[];
}

const matched = (method: PropertyMatchMethod, property: { id: string; name: string }, confidence = 1): PropertyMatchResult => ({ status: 'MATCHED', method, property, confidence, candidates: [{ id: property.id, name: property.name, confidence, matchMethod: method }] });

export async function matchProperty(input: PropertyMatchInput, db?: Db): Promise<PropertyMatchResult> {
  const normalized = normalizePropertyName(input.externalPropertyName || input.propertyName);
  if (input.externalPropertyId) {
    const mapping = await mappingRepo.findActiveByExternalId(input.source, input.externalPropertyId, db);
    if (mapping) return matched('EXTERNAL_ID', { id: mapping.property_id, name: mapping.property_name });
  }

  const aliases = await mappingRepo.findActiveByName(input.source, normalized, db);
  if (aliases.length === 1) return matched('PORTAL_ALIAS', { id: aliases[0].property_id, name: aliases[0].property_name });
  if (aliases.length > 1) return { status: 'AMBIGUOUS', method: 'AMBIGUOUS', property: null, confidence: null, candidates: aliases.map((a) => ({ id: a.property_id, name: a.property_name, confidence: 1, matchMethod: 'PORTAL_ALIAS' })) };

  const exactProperties = await propertyRepo.findByNormalizedPortalName(normalized, db);
  if (exactProperties.length === 1) return matched('NORMALIZED_NAME', { id: exactProperties[0].id, name: exactProperties[0].name });
  if (exactProperties.length > 1) return { status: 'AMBIGUOUS', method: 'AMBIGUOUS', property: null, confidence: null, candidates: exactProperties.map((p) => ({ id: p.id, name: p.name, confidence: 1, matchMethod: 'NORMALIZED_NAME' })) };

  const activeProperties = await propertyRepo.list({ isActive: true }, db);
  const fuzzy = fuzzyCandidates(normalized, activeProperties.map((p) => ({ id: p.id, name: p.name })));
  if (fuzzy.status === 'MATCHED') return matched('FUZZY_NAME', { id: fuzzy.candidates[0].id, name: fuzzy.candidates[0].name }, fuzzy.candidates[0].confidence ?? 0);
  return { status: fuzzy.status, method: fuzzy.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'UNMATCHED', property: null, confidence: fuzzy.candidates[0]?.confidence ?? null, candidates: fuzzy.candidates };
}
