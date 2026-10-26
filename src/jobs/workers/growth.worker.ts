import { Worker } from 'bullmq';
import { growthEngine } from '../../modules/growth/growth.engine';
import { logger } from '../../infra/logger';
import { instrumentWorker } from '../../infra/metrics';
import { workerOptions } from '../../infra/queue';
import { captureJobException } from '../../instrument';

// Processes AUTO requirement completions off the request path (CLAUDE.md §6.2).
export const growthWorker = new Worker(
  'growth',
  async (job) => {
    if (job.name === 'complete-requirement') {
      const { userId, requirementKey } = job.data as { userId: string; requirementKey: string };
      await growthEngine.completeRequirement(userId, requirementKey, 'AUTO');
    }
  },
  workerOptions,
);

growthWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Growth job failed');
  captureJobException('growth', job, err);
});

instrumentWorker(growthWorker, 'growth');
