import { Router } from 'express';
import { handleForceExpireSla, handleResetDemo } from '../controllers/demoController';

/** Only mounted when ENABLE_DEMO_ENDPOINTS=true. */
export const demoRouter = Router();
demoRouter.post('/reset', handleResetDemo);
demoRouter.post('/leads/:id/expire-sla', handleForceExpireSla);
