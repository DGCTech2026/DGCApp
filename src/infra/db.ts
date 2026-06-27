import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from '../config/env';

function makePrisma() {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter, log: ['warn', 'error'] });
}

const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? makePrisma();
if (process.env['NODE_ENV'] !== 'production') g.prisma = prisma;
