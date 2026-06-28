import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { sendOtpSms } from '../../infra/sms';
import { logger } from '../../infra/logger';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

export const smsWorker = new Worker(
  'sms',
  async (job) => {
    const { to, code } = job.data as { to: string; code: string };
    await sendOtpSms(to, code);
  },
  { connection },
);

smsWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'SMS job failed');
});
