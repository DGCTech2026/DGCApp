import { prisma } from './db';
import { redis } from './redis';

type CheckResult = { ok: true; latencyMs: number } | { ok: false; latencyMs: number; error: string };

const CHECK_TIMEOUT_MS = 1500;

export async function readiness() {
  const [database, cache] = await Promise.all([
    check('database', () => prisma.$queryRaw`SELECT 1`),
    check('redis', () => redis.ping()),
  ]);
  const ok = database.ok && cache.ok;

  return {
    ok,
    status: ok ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
    checks: { database, redis: cache },
  };
}

async function check(name: string, fn: () => Promise<unknown>): Promise<CheckResult> {
  const started = process.hrtime.bigint();

  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return { ok: true, latencyMs: elapsedMs(started) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: elapsedMs(started),
      error: err instanceof Error ? err.name : `${name}_check_failed`,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function elapsedMs(started: bigint) {
  return Math.round(Number(process.hrtime.bigint() - started) / 1_000_000);
}
