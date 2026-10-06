import { NotFoundError } from '../../utils/errors';
import * as repo from './customer.repository';
import * as leadRepo from '../leads/lead.repository';
import { toLeadDto } from '../leads/lead.model';
import { toCustomerDto } from './customer.model';

export const listCustomers = async (f: { search?: string; limit: number; offset: number }) =>
  (await repo.list(f)).map(toCustomerDto);

/** Customer plus every enquiry they made, each showing the property they asked about. */
export async function getCustomerDetails(id: string, viewerId?: string) {
  const customer = await repo.findById(id);
  if (!customer) throw new NotFoundError('Customer not found');
  const leads = await leadRepo.list({ customerId: id, limit: 200, offset: 0, viewerId });
  return { ...toCustomerDto(customer), leads: leads.map(toLeadDto).map(({ customer: _c, ...rest }) => rest) };
}

export async function updateCustomer(id: string, input: { name?: string; email?: string | null }) {
  if (!(await repo.findById(id))) throw new NotFoundError('Customer not found');
  await repo.update(id, input);
  return toCustomerDto((await repo.findById(id))!);
}
