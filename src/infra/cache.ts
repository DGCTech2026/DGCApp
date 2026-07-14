import { redis } from './redis';
import { logger } from './logger';

// Read-through JSON cache over the shared Redis client. For read-heavy, rarely-written data
// (member lists, channel meta, profiles, branch/cluster catalogues). Two safety rules:
//   1. A cache failure must never break a request — always fall back to the loader.
//   2. Per-user fields (myRole, isMuted, presence, isMember) are NEVER cached — callers cache
//      the shared payload and merge user-specific bits live.
export async function cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed — falling back to DB');
  }
  const fresh = await load();
  try {
    await redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed');
  }
  return fresh;
}

export async function invalidate(...keys: string[]) {
  if (!keys.length) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, 'cache invalidate failed');
  }
}

// Single place for key shapes so services and invalidators can't drift apart.
export const cacheKeys = {
  channelMeta: (channelId: string) => `cache:channel:${channelId}:meta`,
  channelMembers: (channelId: string) => `cache:channel:${channelId}:members`,
  userProfile: (userId: string) => `cache:user:${userId}:profile`,
  branches: 'cache:branches',
  branch: (id: string) => `cache:branch:${id}`,
  clusters: 'cache:clusters',
};
