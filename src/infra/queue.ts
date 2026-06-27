import { Queue } from 'bullmq';
import { env } from '../config/env';

// Pass URL string directly so BullMQ uses its own bundled ioredis — avoids type conflicts
// between the top-level ioredis and BullMQ's internal copy.
const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

export const emailQueue = new Queue('email', { connection });
export const notificationQueue = new Queue('notification', { connection });
export const growthQueue = new Queue('growth', { connection });
