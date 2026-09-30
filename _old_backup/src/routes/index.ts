import { Router } from 'express';
import { env } from '../config/env';
import { demoRouter } from './demoRoutes';
import { customerRouter } from './customerRoutes';
import { dashboardRouter } from './dashboardRoutes';
import { enquiryRouter } from './enquiryRoutes';
import { followUpRouter } from './followUpRoutes';
import { leadRouter } from './leadRoutes';
import { notificationRouter } from './notificationRoutes';
import { projectRouter } from './projectRoutes';
import { propertyRouter } from './propertyRoutes';
import { teamRouter } from './teamRoutes';
import { userRouter } from './userRoutes';

export const apiRouter = Router();


apiRouter.use('/customers', customerRouter);
apiRouter.use('/teams', teamRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/properties', propertyRouter);
apiRouter.use('/leads', leadRouter);
apiRouter.use('/follow-ups', followUpRouter);
apiRouter.use('/enquiries', enquiryRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/dashboard', dashboardRouter);

if (env.ENABLE_DEMO_ENDPOINTS) apiRouter.use('/demo', demoRouter);
