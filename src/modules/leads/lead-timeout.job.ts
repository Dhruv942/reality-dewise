import { msUntilNextTimeout, runLeadTimeoutSweep, runSlaWarningPass } from './lead.service';

/**
 * Runs the lead timeout sweep inside the API process. No separate scheduler is needed: the sweep is safe to run
 * from several instances at once (every lead is re-checked under a row lock with SKIP LOCKED), and a pass that is
 * still running is never started twice in the same process. Returns a function that stops it.
 *
 * It wakes up every `intervalSeconds`, but also exactly when the earliest running SLA runs out, so a lead is
 * reassigned about a second after its deadline instead of up to a full interval later.
 */
export function startLeadTimeoutJob(intervalSeconds: number): () => void {
  let running = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (running || stopped) return;
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
      await schedule();
    }
  };

  const schedule = async (): Promise<void> => {
    if (stopped) return;
    let delay = intervalSeconds * 1000;
    try {
      const next = await msUntilNextTimeout();
      if (next !== null) delay = Math.min(delay, Math.max(next + 300, 1000));
    } catch (err) {
      console.error('Lead timeout scheduling failed:', err instanceof Error ? err.message : err);
    }
    timer = setTimeout(() => void tick(), delay);
    timer.unref(); // never keeps the process alive on its own
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
