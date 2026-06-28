import { logger } from '../infra/logger';
import './workers/email.worker';
import './workers/sms.worker';
import './workers/notification.worker';
import './workers/growth.worker';

export function startWorkers() {
  logger.info('Workers started (in-process)');
}
