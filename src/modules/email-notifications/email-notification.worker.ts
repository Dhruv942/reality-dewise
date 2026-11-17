import * as service from './email-notification.service';

export function startEmailNotificationJob(intervalSeconds = 15): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await service.processPending(); } catch (err) { console.error('Email notification worker failed:', err instanceof Error ? err.message : 'unknown error'); }
    finally { running = false; }
  };
  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
