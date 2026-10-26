import { Queue } from 'bullmq';
import { env } from '../config/env';

// Pass URL string directly so BullMQ uses its own bundled ioredis — avoids type conflicts
// between the top-level ioredis and BullMQ's internal copy.
export const bullConnection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };

// Paid Render Key Value still has a hard maxmemory. Once it is full, Redis rejects the
// script that would delete old jobs, and the queues can never drain. Keep almost nothing.
const queueOptions = {
  connection: bullConnection,
  streams: { events: { maxLen: 100 } },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { count: 20 },
  },
};

// Same retention on the worker, so a job finishes clean even if it was queued without options.
// concurrency 5 per queue on every copy of the one web service. Extra copies share the jobs.
export const workerOptions = {
  connection: bullConnection,
  concurrency: 5,
  removeOnComplete: { count: 0 },
  removeOnFail: { count: 20 },
};

export const emailQueue = new Queue('email', queueOptions);
export const smsQueue = new Queue('sms', queueOptions);
export const notificationQueue = new Queue('notification', queueOptions);
export const growthQueue = new Queue('growth', queueOptions);
