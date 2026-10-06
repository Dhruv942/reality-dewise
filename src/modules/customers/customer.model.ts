export const CUSTOMER_TYPES = ['INDIVIDUAL', 'COMPANY'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export interface CustomerRow {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  type: CustomerType;
  created_at: Date;
  updated_at: Date;
}

export const toCustomerDto = (c: CustomerRow) => ({
  id: c.id,
  name: c.name,
  mobile: c.mobile,
  email: c.email,
  type: c.type,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});
