import { Request, Response } from 'express';
import { resetAndSeed } from '../db/seed';
import { forceExpireLead } from '../services/slaService';
import { getLead } from '../services/leadService';

export async function handleResetDemo(_req: Request, res: Response) {
  await resetAndSeed();
  res.json({ data: { reset: true } });
}

export async function handleForceExpireSla(req: Request, res: Response) {
  const id = Number(req.params.id);
  const result = await forceExpireLead(id);
  res.json({ ...result, lead: await getLead(id) });
}
