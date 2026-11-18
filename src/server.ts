import { env } from './config/env';
import { pool } from './database/pool';
import { createApp } from './app';
import { startLeadTimeoutJob } from './modules/leads/lead-timeout.job';
import { closeSocketServer, initSocketServer } from './realtime/socket';
import { startEmailNotificationJob } from './modules/email-notifications/email-notification.worker';

const server = createApp().listen(env.PORT, () => {
  console.log(`API listening on port ${env.PORT} (${env.NODE_ENV})`);
});
// Must exceed the reverse proxy's idle timeout, or the proxy reuses a connection Node just closed (sporadic 502s).
server.keepAliveTimeout = env.KEEP_ALIVE_TIMEOUT_MS;
server.headersTimeout = env.KEEP_ALIVE_TIMEOUT_MS + 5_000;
server.requestTimeout = 60_000;

if (env.NODE_ENV === 'production') {
  for (const [name, secret] of [['MAGICBRICKS_WEBHOOK_SECRET', env.MAGICBRICKS_WEBHOOK_SECRET], ['ACRES99_WEBHOOK_SECRET', env.ACRES99_WEBHOOK_SECRET]] as const) {
    if (!secret) console.warn(`${name} is not set: that portal webhook accepts requests from anyone who knows the URL`);
  }
}

// Socket.IO shares this HTTP server: a live delivery channel for lead events and notifications.
initSocketServer(server);

// Reassign leads nobody handled within the timeout (the SLA: an admin setting, default 90 minutes, counted 24/7).
const stopLeadTimeoutJob = env.LEAD_TIMEOUT_JOB_ENABLED ? startLeadTimeoutJob(env.LEAD_TIMEOUT_CHECK_INTERVAL_SECONDS) : () => {};
const stopEmailNotificationJob = startEmailNotificationJob(15);

let shuttingDown = false;
function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // A hung connection must never keep the process alive forever: the supervisor restarts it after this deadline.
  setTimeout(() => {
    console.error(`Graceful shutdown timed out after ${env.SHUTDOWN_TIMEOUT_MS} ms, forcing exit`);
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS).unref();
  stopLeadTimeoutJob();
  stopEmailNotificationJob();
  // Closes every socket connection and the HTTP server underneath (server.close() alone would wait for them).
  void closeSocketServer()
    .catch((err) => console.error('Socket shutdown failed:', err instanceof Error ? err.message : err))
    .finally(() => void pool.end().finally(() => process.exit(exitCode)));
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

// Log the reason, then exit so the supervisor starts a clean process (state after these is unknown).
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : reason);
  shutdown(1);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.stack ?? err.message);
  shutdown(1);
});
