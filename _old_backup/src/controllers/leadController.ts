import { Request, Response } from 'express';
import { createLead, getLead, getLeadHistory, listLeads, updateLeadStatus } from '../services/leadService';
import { assignLeadManually } from '../services/assignmentService';
import { assignLeadSchema, createLeadSchema, listLeadsQuerySchema, updateLeadStatusSchema } from '../validators';

export async function handleCreateLead(req: Request, res: Response) {
  const body = createLeadSchema.parse(req.body);
  const result = await createLead(body);
  res.status(result.duplicate ? 200 : 201).json(result);
}

export async function handleListLeads(req: Request, res: Response) {
  const query = listLeadsQuerySchema.parse(req.query);
  const result = await listLeads(query, { page: query.page, limit: query.limit });
  res.json(result);
}

export async function handleGetLead(req: Request, res: Response) {
  const id = Number(req.params.id);
  const lead = await getLead(id);
  res.json(lead);
}

export async function handleGetLeadHistory(req: Request, res: Response) {
  const id = Number(req.params.id);
  const history = await getLeadHistory(id);
  res.json(history);
}

export async function handleUpdateLeadStatus(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = updateLeadStatusSchema.parse(req.body);
  const updated = await updateLeadStatus(id, body.status, {
    changedBy: body.changedBy,
    reason: body.reason,
  });
  res.json(updated);
}

export async function handleAssignLead(req: Request, res: Response) {
  const id = Number(req.params.id);
  const { userId } = assignLeadSchema.parse(req.body);
  await assignLeadManually(id, userId);
  res.json(await getLead(id));
}
