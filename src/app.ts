import path from 'node:path';
import cors from 'cors';
import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import { createAuthRouter } from './modules/auth/auth.routes';
import { env } from './config/env';
import { pool } from './database/pool';
import { adminRouter } from './modules/admin/admin.routes';
import { portalRouter } from './modules/executive-portal/portal.routes';
import { managerPortalRouter } from './modules/manager-portal/portal.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { createLoginLimiter } from './middleware/rateLimit';

export interface AppOptions {
  /** Override the failed-login limit (tests). Defaults to LOGIN_RATE_LIMIT_MAX. */
  loginRateLimitMax?: number;
}

/** `mount` lets future modules (and tests) add routes under /api/v1 before the 404/error handlers. */
export function createApp(mount?: (api: Router) => void, options: AppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY !== undefined) app.set('trust proxy', env.TRUST_PROXY);

  // Dev-only manual test page. Registered before helmet: its CSP would block the page's inline script.
  if (env.NODE_ENV !== 'production') {
    app.get('/test-console', (_req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'test-console.html'));
    });
  }

  app.use(helmet());
  // No origins configured => no CORS headers at all (same-origin only).
  if (env.corsOrigins.length > 0) {
    app.use(cors({ origin: env.corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600 }));
  }
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'unavailable', db: 'down' });
    }
  });

  const api = express.Router();
  api.use('/auth', createAuthRouter(createLoginLimiter(options.loginRateLimitMax)));
  api.use('/admin', adminRouter);
  api.use('/executive', portalRouter);
  api.use('/manager', managerPortalRouter);
  mount?.(api);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
