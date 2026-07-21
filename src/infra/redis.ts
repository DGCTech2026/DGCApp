import { Redis } from 'ioredis';
import { env } from '../config/env';

// BullMQ + socket adapter both need maxRetriesPerRequest: null.
export const makeRedis = () => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Shared general-purpose client (rate limiting, caching, presence, OTP grace markers).
// commandTimeout bounds every command: while Redis is unreachable, ioredis queues commands
// FOREVER by default — one Redis blip would hang every request that touches it. 2s turns
// "hangs forever" into "fails fast, caller falls back". The BullMQ/socket-adapter connections
// (which need long-blocking commands) are created separately via makeRedis and stay unbounded.
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, commandTimeout: 2000 });

// Race a Redis read against a deadline and resolve with `fallback` on timeout OR error.
// For hot paths (cache reads, presence) even 2s is too long to stall a request — degrade
// to the fallback in ~300ms and let the DB/default answer instead.
export function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}
