import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { growthEngine } from '../../modules/growth/growth.engine';
import { logger } from '../../infra/logger';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

// Processes AUTO requirement completions off the request path (CLAUDE.md §6.2).
export const growthWorker = new Worker(
  'growth',
  async (job) => {
    if (job.name === 'complete-requirement') {
      const { userId, requirementKey } = job.data as { userId: string; requirementKey: string };
      await growthEngine.completeRequirement(userId, requirementKey, 'AUTO');
    }
  },
  { connection },
);

growthWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Growth job failed');
});
