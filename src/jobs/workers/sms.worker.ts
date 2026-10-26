import { Worker } from 'bullmq';
import { sendOtpSms } from '../../infra/sms';
import { logger } from '../../infra/logger';
import { instrumentWorker } from '../../infra/metrics';
import { workerOptions } from '../../infra/queue';
import { captureJobException } from '../../instrument';

export const smsWorker = new Worker(
  'sms',
  async (job) => {
    const { to, code } = job.data as { to: string; code: string };
    await sendOtpSms(to, code);
  },
  workerOptions,
);

smsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'SMS job failed');
  captureJobException('sms', job, err);
});

instrumentWorker(smsWorker, 'sms');
