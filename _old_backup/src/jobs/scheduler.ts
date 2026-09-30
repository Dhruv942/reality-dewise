import cron, { ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { assignPendingLeads } from '../services/assignmentService';
import { markMissedFollowUps, sendFollowUpReminders } from '../services/followUpService';
import { processExpiredAssignments, sendSlaWarnings } from '../services/slaService';

let scheduledTasks: ScheduledTask[] = [];

export function startBackgroundJobs() {
  if (!env.ENABLE_JOBS) {
    console.log('[JOBS] Background jobs disabled via ENABLE_JOBS=false');
    return;
  }

  console.log('[JOBS] Starting background workers...');

  const slaTask = cron.schedule(env.JOB_SLA_CRON, async () => {
    try {
      const expiredCount = await processExpiredAssignments();
      const warningCount = await sendSlaWarnings();
      const pendingAssigned = await assignPendingLeads();
      if (expiredCount > 0 || warningCount > 0 || pendingAssigned > 0) {
        console.log(`[JOBS] SLA run: ${expiredCount} reassigned, ${warningCount} warnings sent, ${pendingAssigned} pending leads assigned`);
      }
    } catch (err) {
      console.error('[JOBS] Error in SLA background job:', err);
    }
  });

  const followUpTask = cron.schedule(env.JOB_FOLLOW_UP_CRON, async () => {
    try {
      const remindersSent = await sendFollowUpReminders();
      const missedCount = await markMissedFollowUps();
      if (remindersSent > 0 || missedCount > 0) {
        console.log(`[JOBS] Follow-up run: ${remindersSent} reminders sent, ${missedCount} marked missed`);
      }
    } catch (err) {
      console.error('[JOBS] Error in follow-up background job:', err);
    }
  });

  scheduledTasks.push(slaTask, followUpTask);
}

export function stopBackgroundJobs() {
  for (const task of scheduledTasks) {
    task.stop();
  }
  scheduledTasks = [];
}
