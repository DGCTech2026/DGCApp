import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { logger } from '../../infra/logger';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

export const growthWorker = new Worker(
  'growth',
  async (job) => {
    // TODO: implement stage-transition recompute logic
    logger.info({ jobId: job.id, data: job.data }, 'Growth job received');
  },
  { connection },
);

growthWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Growth job failed');
});
