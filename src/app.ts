import path from 'node:path';
import express, { type Express, type Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { env } from './config/env';
import { adminRouter } from './modules/admin/admin.routes';
import { portalRouter } from './modules/executive-portal/portal.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

/** `mount` lets future modules (and tests) add routes under /api/v1 before the 404/error handlers. */
export function createApp(mount?: (api: Router) => void): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Dev-only manual test page. Never served in production.
  if (env.NODE_ENV !== 'production') {
    app.get('/test-console', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'test-console.html'));
    });
  }

  const api = express.Router();
  api.use('/auth', authRouter);
  api.use('/admin', adminRouter);
  api.use('/executive', portalRouter);
  mount?.(api);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
