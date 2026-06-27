import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { sendOtpEmail } from '../../infra/brevo';
import { logger } from '../../infra/logger';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

export const emailWorker = new Worker(
  'email',
  async (job) => {
    const { type, to, code } = job.data as { type: string; to: string; code: string };
    if (type === 'otp') {
      await sendOtpEmail(to, code);
      logger.info({ to }, 'OTP email sent');
    }
  },
  { connection },
);

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Email job failed');
});
