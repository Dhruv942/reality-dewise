import { Router } from 'express';
import * as c from './report.controller';

export const reportRouter = Router();
reportRouter.get('/overview', c.overview);
reportRouter.get('/leads', c.leads);
reportRouter.get('/executives', c.executives);
reportRouter.get('/managers', c.managers);
reportRouter.get('/sources', c.sources);
reportRouter.get('/properties', c.properties);
reportRouter.get('/transactions', c.transactions);
reportRouter.get('/follow-ups', c.followUps);
