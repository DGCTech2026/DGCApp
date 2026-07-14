import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from '../config/env';

function makePrisma() {
  // Default max is 10 — bursts of concurrent requests queue behind it. Render Postgres allows
  // far more; 20 keeps headroom for the worker's connections on the same instance.
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 20, keepAlive: true });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? makePrisma();
if (process.env['NODE_ENV'] !== 'production') g.prisma = prisma;
