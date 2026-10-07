import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import { parse } from '../../utils/validate';
import * as service from './notification.service';

const self = (req: Request): string => {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
};

const listQuery = z.object({
  unread: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const idParam = z.object({ id: z.uuid() });

export const list = async (req: Request, res: Response) => {
  const q = parse(listQuery, req.query);
  res.json(await service.listMine(self(req), { unreadOnly: q.unread, limit: q.limit, offset: q.offset }));
};
export const markRead = async (req: Request, res: Response) => {
  res.json(await service.markRead(self(req), parse(idParam, req.params).id));
};
export const markAllRead = async (req: Request, res: Response) => {
  res.json(await service.markAllRead(self(req)));
};
