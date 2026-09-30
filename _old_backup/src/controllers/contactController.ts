import { Request, Response } from 'express';
import { contactLead } from '../services/contactService';
import { contactLeadSchema } from '../validators';

export async function handleContactLead(req: Request, res: Response) {
  const leadId = Number(req.params.id);
  const body = contactLeadSchema.parse(req.body);
  const updatedLead = await contactLead(leadId, body);
  res.json(updatedLead);
}
