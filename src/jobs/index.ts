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
  // Repeatable scan (every 5 min) for scheduled audio rooms — 15-min "starting soon" window,
  // so the tighter cadence keeps reminders close to the actual start time.
  notificationQueue
    .upsertJobScheduler('audio-room-reminders', { every: 5 * 60 * 1000 }, { name: 'audio-room-reminders-scan' })
    .then(() => logger.info('Audio-room-reminder scheduler registered'))
    .catch((err) => logger.error({ err }, 'Failed to register audio-room reminder scheduler'));
  // Daily janitor: wipes expired OTPs, aged notifications, and stale reminders.
  notificationQueue
    .upsertJobScheduler('janitor', { every: 24 * 60 * 60 * 1000 }, { name: 'janitor-scan' })
    .then(() => logger.info('Janitor scheduler registered'))
    .catch((err) => logger.error({ err }, 'Failed to register janitor scheduler'));
  logger.info('Workers started (in-process)');
}
