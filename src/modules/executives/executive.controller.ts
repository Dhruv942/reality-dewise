import type { Request, Response } from 'express';
import { parse } from '../../utils/validate';
import { executiveService, managerService } from './executive.service';
import { executiveIdParam, idParam, listExecutivesQuery } from './executive.validation';

type UserService = typeof executiveService;

/** Controllers for an account type (sales executives or managers): thin wrappers over the shared user service. */
function createController(service: UserService, label: 'Executive' | 'Manager', key: 'executive' | 'manager') {
  return {
    list: async (req: Request, res: Response) => {
      res.json(await service.list(parse(listExecutivesQuery, req.query)));
    },
    get: async (req: Request, res: Response) => {
      res.json(await service.details(parse(idParam, req.params).id));
    },
    create: async (req: Request, res: Response) => {
      res.status(201).json(await service.create(req.body));
    },
    update: async (req: Request, res: Response) => {
      res.json(await service.update(parse(idParam, req.params).id, req.body));
    },
    changePassword: async (req: Request, res: Response) => {
      await service.changePassword(parse(idParam, req.params).id, req.body.password);
      res.json({ success: true, message: 'Password updated' });
    },
    setStatus: async (req: Request, res: Response) => {
      res.json(await service.setStatus(parse(idParam, req.params).id, req.body.isActive));
    },
    remove: async (req: Request, res: Response) => {
      const user = await service.remove(parse(idParam, req.params).id);
      res.json({
        success: true,
        message: `${label} was soft-deleted: the account is deactivated and hidden, history is preserved`,
        [key]: user,
      });
    },
    assignTeam: async (req: Request, res: Response) => {
      res.json(await service.assignTeam(parse(executiveIdParam, req.params).executiveId, req.body.teamId));
    },
    removeFromTeam: async (req: Request, res: Response) => {
      res.json(await service.removeFromTeam(parse(executiveIdParam, req.params).executiveId));
    },
  };
}

export const executiveController = createController(executiveService, 'Executive', 'executive');
export const managerController = createController(managerService, 'Manager', 'manager');
