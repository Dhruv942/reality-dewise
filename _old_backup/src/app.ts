import express, { Express } from 'express';
import { apiRouter } from './routes';
import { errorHandler } from './utils/errors';

export function createApp(): Express {
  const app = express();

  app.use(express.json());

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount API v1 router
  app.use('/api/v1', apiRouter);

  // Global 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}
