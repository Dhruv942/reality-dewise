export interface CustomerRow {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

export const toCustomerDto = (c: CustomerRow) => ({
  id: c.id,
  name: c.name,
  mobile: c.mobile,
  email: c.email,
  createdAt: c.created_at,
  updatedAt: c.updated_at,
});
