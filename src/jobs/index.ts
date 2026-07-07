import { logger } from '../infra/logger';
import { notificationQueue } from '../infra/queue';
import './workers/email.worker';
import './workers/sms.worker';
import './workers/notification.worker';
import './workers/growth.worker';

export function startWorkers() {
  // Repeatable scan (every 15 min) that sends pre-event reminders. Idempotent across restarts.
  notificationQueue
    .upsertJobScheduler('event-reminders', { every: 15 * 60 * 1000 }, { name: 'event-reminders-scan' })
    .then(() => logger.info('Event-reminder scheduler registered'))
    .catch((err) => logger.error({ err }, 'Failed to register reminder scheduler'));
  logger.info('Workers started (in-process)');
}
