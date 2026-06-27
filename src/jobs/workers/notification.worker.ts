import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { logger } from '../../infra/logger';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

export const notificationWorker = new Worker(
  'notification',
  async (job) => {
    // TODO: implement push notification delivery (FCM via firebase-admin)
    logger.info({ jobId: job.id, data: job.data }, 'Notification job received');
  },
  { connection },
);

notificationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Notification job failed');
});
