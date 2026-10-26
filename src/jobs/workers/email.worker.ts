import { Worker } from 'bullmq';
import { sendOtpEmail, sendResetOtpEmail } from '../../infra/brevo';
import { logger } from '../../infra/logger';
import { instrumentWorker } from '../../infra/metrics';
import { workerOptions } from '../../infra/queue';
import { captureJobException } from '../../instrument';

export const emailWorker = new Worker(
  'email',
  async (job) => {
    const { type, to, code } = job.data as { type: string; to: string; code: string };
    if (type === 'otp') {
      await sendOtpEmail(to, code);
      logger.info({ to }, 'OTP email sent');
    } else if (type === 'reset-otp') {
      await sendResetOtpEmail(to, code);
      logger.info({ to }, 'Reset OTP email sent');
    }
  },
  workerOptions,
);

emailWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Email job failed');
  captureJobException('email', job, err);
});

instrumentWorker(emailWorker, 'email');
