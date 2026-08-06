// Diagnostic: what does the branches cache currently look like, and does the DB agree?
// Run: npx tsx -r dotenv/config scripts/inspect-branch-cache.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const redis = new Redis(process.env['REDIS_URL']!, { maxRetriesPerRequest: 3 });

async function main() {
  const dbBranches = await prisma.branch.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });
  console.log(`\n=== DB — prisma.branch.findMany ===\n  ${dbBranches.length} branches`);
  for (const b of dbBranches) console.log(`    - ${b.name}`);

  const cached = await redis.get('cache:branches');
  console.log(`\n=== Redis — cache:branches ===`);
  if (cached === null) {
    console.log('  (key not set — next request will populate)');
  } else {
    console.log(`  raw length: ${cached.length} chars`);
    try {
      const parsed = JSON.parse(cached) as unknown[];
      console.log(`  parsed: ${Array.isArray(parsed) ? parsed.length : 'not-an-array'} entries`);
      if (Array.isArray(parsed) && parsed.length === 0) {
        console.log('  ⚠ POISONED — empty array cached. Every request during TTL returns empty.');
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`  first entry: ${JSON.stringify(parsed[0])}`);
      }
    } catch {
      console.log('  (unparseable JSON)');
    }
    const ttl = await redis.ttl('cache:branches');
    console.log(`  TTL remaining: ${ttl}s`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); redis.quit(); });
