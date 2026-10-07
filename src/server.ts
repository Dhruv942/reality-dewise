import { env } from './config/env';
import { pool } from './database/pool';
import { createApp } from './app';
import { startLeadTimeoutJob } from './modules/leads/lead-timeout.job';
import { closeSocketServer, initSocketServer } from './realtime/socket';

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Socket.IO shares this HTTP server: a live delivery channel for lead events and notifications.
initSocketServer(server);

// Reassign leads nobody handled within the timeout (the SLA: an admin setting, default 90 minutes, counted 24/7).
const stopLeadTimeoutJob = env.LEAD_TIMEOUT_JOB_ENABLED ? startLeadTimeoutJob(env.LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS) : () => {};

function shutdown(): void {
  stopLeadTimeoutJob();
  // Closes every socket connection and the HTTP server underneath (server.close() alone would wait for them).
  void closeSocketServer().finally(() => void pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
