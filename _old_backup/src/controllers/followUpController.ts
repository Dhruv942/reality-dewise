import { Request, Response } from 'express';
import {
  cancelFollowUp,
  completeFollowUp,
  createFollowUp,
  getFollowUp,
  listFollowUps,
  listLeadFollowUps,
  rescheduleFollowUp,
} from '../services/followUpService';
import {
  completeFollowUpSchema,
  createFollowUpSchema,
  listFollowUpsQuerySchema,
  rescheduleFollowUpSchema,
} from '../validators';

export async function handleCreateFollowUp(req: Request, res: Response) {
  const leadId = Number(req.params.id);
  const body = createFollowUpSchema.parse(req.body);
  const followUp = await createFollowUp(leadId, body);
  res.status(201).json(followUp);
}

export async function handleListLeadFollowUps(req: Request, res: Response) {
  const leadId = Number(req.params.id);
  const followUps = await listLeadFollowUps(leadId);
  res.json({ data: followUps });
}

export async function handleListFollowUps(req: Request, res: Response) {
  const query = listFollowUpsQuerySchema.parse(req.query);
  const result = await listFollowUps(query, { page: query.page, limit: query.limit });
  res.json(result);
}

export async function handleGetFollowUp(req: Request, res: Response) {
  const id = Number(req.params.id);
  const followUp = await getFollowUp(id);
  res.json(followUp);
}

export async function handleCompleteFollowUp(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = completeFollowUpSchema.parse(req.body);
  const result = await completeFollowUp(id, body);
  res.json(result);
}

export async function handleRescheduleFollowUp(req: Request, res: Response) {
  const id = Number(req.params.id);
  const body = rescheduleFollowUpSchema.parse(req.body);
  const result = await rescheduleFollowUp(id, body);
  res.json(result);
}

export async function handleCancelFollowUp(req: Request, res: Response) {
  const id = Number(req.params.id);
  const result = await cancelFollowUp(id);
  res.json(result);
}
