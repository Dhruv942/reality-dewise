import { Db } from '../db/pool';
import type { Customer } from '../models/types';
import { customerRepository } from '../repositories/customerRepository';
import { normalizeMobile } from '../utils/mobile';

export interface CustomerInput { name: string; mobile: string; email?: string | null }

/**
 * Duplicate detection: a customer is identified by normalized mobile number.
 * Race-safe: two concurrent calls with the same mobile end up with the same customer, because the
 * INSERT ... ON CONFLICT DO NOTHING is backed by the UNIQUE(mobile) constraint.
 * Existing customers are returned untouched (name is never overwritten); only a missing email is back-filled.
 */
export async function findOrCreateCustomer(db: Db, input: CustomerInput): Promise<{ customer: Customer; created: boolean }> {
  const mobile = normalizeMobile(input.mobile);
  const inserted = await customerRepository.insertIgnoreDuplicate(db, { name: input.name.trim(), mobile, email: input.email });
  if (inserted) return { customer: inserted, created: true };
  return { customer: await customerRepository.touchExisting(db, mobile, input.email), created: false };
}
