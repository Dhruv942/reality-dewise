import { env } from './config/env';
import { pool } from './database/pool';
import { createApp } from './app';
import { startLeadTimeoutJob } from './modules/leads/lead-timeout.job';

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Reassign leads nobody handled within the timeout (the SLA: an admin setting, default 90 minutes, counted 24/7).
const stopLeadTimeoutJob = env.LEAD_TIMEOUT_JOB_ENABLED ? startLeadTimeoutJob(env.LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS) : () => {};

function shutdown(): void {
  stopLeadTimeoutJob();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
