import { Request, Response } from 'express';
import {
  convertToLead,
  createEnquiry,
  findMatchingProperties,
  getEnquiry,
  listEnquiries,
  updateEnquiry,
} from '../services/enquiryService';
import {
  convertEnquirySchema,
  createEnquirySchema,
  listEnquiriesQuerySchema,
  updateEnquirySchema,
} from '../validators';

export async function handleCreateEnquiry(req: Request, res: Response) {
  const body = createEnquirySchema.parse(req.body);
  const enquiry = await createEnquiry({
    ...body,
    email: body.email ?? undefined,
    requirement: body.requirement ?? undefined,
    bhk: body.bhk ?? undefined,
    budget: body.budget ?? undefined,
    projectId: body.projectId ?? undefined,
    notes: body.notes ?? undefined,
    createdBy: body.createdBy ?? undefined,
  });
  res.status(201).json(enquiry);
}

export async function handleListEnquiries(req: Request, res: Response) {
  const query = listEnquiriesQuerySchema.parse(req.query);
  const result = await listEnquiries(query, { page: query.page, limit: query.limit });
  res.json(result);
}

export async function handleGetEnquiry(req: Request, res: Response) {
  const id = Number(req.params.id);
  const enquiry = await getEnquiry(id);
  res.json(enquiry);
}

export async function handleUpdateEnquiry(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updateEnquirySchema.parse(req.body);
  const enquiry = await updateEnquiry(id, {
    ...body,
    email: body.email ?? undefined,
    requirement: body.requirement ?? undefined,
    bhk: body.bhk ?? undefined,
    budget: body.budget ?? undefined,
    projectId: body.projectId ?? undefined,
    notes: body.notes ?? undefined,
    createdBy: body.createdBy ?? undefined,
  });
  res.json(enquiry);
}

export async function handleFindMatchingProperties(req: Request, res: Response) {
  const id = Number(req.params.id);
  const properties = await findMatchingProperties(id);
  res.json({ data: properties });
}

export async function handleConvertToLead(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = convertEnquirySchema.parse(req.body);
  const result = await convertToLead(id, body);
  res.status(201).json(result);
}
