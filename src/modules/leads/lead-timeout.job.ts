import { runLeadTimeoutSweep, runSlaWarningPass } from './lead.service';

/**
 * Runs the lead timeout sweep on a timer inside the API process. No separate scheduler is needed: the sweep is
 * safe to run from several instances at once (every lead is re-checked under a row lock with SKIP LOCKED), and a
 * pass that is still running is never started twice in the same process. Returns a function that stops it.
 */
export function startLeadTimeoutJob(intervalSeconds: number): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await runLeadTimeoutSweep();
      if (r.reassigned > 0 || r.failed > 0) {
        console.log(`Lead timeout (${r.timeoutMinutes} min): ${r.reassigned} reassigned, ${r.skipped} skipped, ${r.failed} failed`);
      }
      const warned = await runSlaWarningPass();
      if (warned > 0) console.log(`SLA warning: ${warned} executive(s) warned`);
    } catch (err) {
      console.error('Lead timeout sweep failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalSeconds * 1000);
  timer.unref(); // never keeps the process alive on its own
  void tick();
  return () => clearInterval(timer);
}
