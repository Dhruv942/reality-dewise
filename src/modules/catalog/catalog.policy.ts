export const TRANSACTION_TYPES = ['RENT_LEASE', 'SALE_PURCHASE'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PROPERTY_TYPES = ['RESIDENTIAL', 'COMMERCIAL'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const PRICE_BANDS = [
  'THOUSANDS',
  'LAKHS',
  'UP_TO_2_CR',
  'ABOVE_2_TO_4_CR',
  'ABOVE_4_TO_6_CR',
  'ABOVE_6_TO_8_CR',
  'ABOVE_8_CR',
  'UNKNOWN',
  'MIXED',
] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

const LAKH = 100_000;
const CRORE = 10_000_000;

const bandFor = (price: number): Exclude<PriceBand, 'UNKNOWN' | 'MIXED'> => {
  if (price < LAKH) return 'THOUSANDS';
  if (price < CRORE) return 'LAKHS';
  if (price <= 2 * CRORE) return 'UP_TO_2_CR';
  if (price <= 4 * CRORE) return 'ABOVE_2_TO_4_CR';
  if (price <= 6 * CRORE) return 'ABOVE_4_TO_6_CR';
  if (price <= 8 * CRORE) return 'ABOVE_6_TO_8_CR';
  return 'ABOVE_8_CR';
};

export function classifyPriceBand(minimum?: number | null, maximum?: number | null): PriceBand {
  if (minimum !== null && minimum !== undefined && minimum < 0) throw new Error('Price cannot be negative');
  if (maximum !== null && maximum !== undefined && maximum < 0) throw new Error('Price cannot be negative');
  if (minimum !== null && minimum !== undefined && maximum !== null && maximum !== undefined && minimum > maximum) {
    throw new Error('minimum price cannot exceed maximum price');
  }
  if (minimum === null || minimum === undefined) return 'UNKNOWN';
  const lower = bandFor(minimum);
  if (maximum === null || maximum === undefined || lower === bandFor(maximum)) return lower;
  return 'MIXED';
}

export const INVENTORY_STATUSES = ['AVAILABLE', 'RESERVED', 'SOLD', 'RENTED', 'EXPIRED', 'INACTIVE'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

const transitions: Record<InventoryStatus, readonly InventoryStatus[]> = {
  AVAILABLE: ['RESERVED', 'SOLD', 'RENTED', 'EXPIRED', 'INACTIVE'],
  RESERVED: ['AVAILABLE', 'SOLD', 'RENTED', 'EXPIRED', 'INACTIVE'],
  SOLD: ['INACTIVE'],
  RENTED: ['AVAILABLE', 'EXPIRED', 'INACTIVE'],
  EXPIRED: ['AVAILABLE', 'INACTIVE'],
  INACTIVE: ['AVAILABLE'],
};

export const canTransitionInventory = (from: InventoryStatus, to: InventoryStatus) => from === to || transitions[from].includes(to);

