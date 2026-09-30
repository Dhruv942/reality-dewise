import { createApp } from './app';
import { env } from './config/env';
import { startBackgroundJobs } from './jobs/scheduler';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[SERVER] Real Estate CRM Backend listening on port ${env.PORT}`);
  startBackgroundJobs();
});

const shutdown = () => {
  console.log('[SERVER] Shutting down gracefully...');
  server.close(() => {
    console.log('[SERVER] Closed HTTP server.');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
