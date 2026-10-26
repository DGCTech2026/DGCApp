// Free Redis when BullMQ has filled it and every queue script answers
// "OOM command not allowed when used memory > 'maxmemory'".
// Deletes only bull:* keys (email, sms, notification, growth jobs and their logs).
// Does not touch login sessions, OTP codes, or rate-limit counters.
// UNLINK is used instead of a Lua script because Redis rejects scripts while it is over maxmemory.
//
// Run on the Render shell, where REDIS_URL resolves:
//   npx tsx -r dotenv/config scripts/clear-stuck-queues.ts
import { Redis } from 'ioredis';

const url = process.env['REDIS_URL'];
if (!url) {
  console.error('REDIS_URL is not set');
  process.exit(1);
}

const redis = new Redis(url, { maxRetriesPerRequest: null, commandTimeout: 10000 });

async function main() {
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'bull:*', 'COUNT', 200);
    cursor = next;
    if (keys.length) {
      await redis.unlink(...keys);
      removed += keys.length;
      console.log(`removed ${removed}`);
    }
  } while (cursor !== '0');

  const info = await redis.info('memory');
  for (const line of info.split('\n')) {
    if (line.startsWith('used_memory_human') || line.startsWith('maxmemory_human')) {
      console.log(line.trim());
    }
  }
  console.log(`\n✓ Removed ${removed} queue key(s). Codes and sessions were left in place.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => redis.quit());
