import { Redis } from 'ioredis';
import { env } from '../config/env';

// BullMQ + socket adapter both need maxRetriesPerRequest: null.
export const makeRedis = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Shared general-purpose client (rate limiting, caching).
export const redis = makeRedis();
