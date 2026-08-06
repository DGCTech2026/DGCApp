// Add the 5 continental branches (Africa, Asia, Europe, North America, South America) to
// production. Idempotent — upserts by branch name, creates section channels with skipDuplicates,
// invalidates the branches cache key so the new list is served on the next request.
// Run: npx tsx -r dotenv/config scripts/add-continental-branches.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const NEW_BRANCHES = [
  { name: 'DGC Africa', city: 'Africa', country: 'Africa' },
  { name: 'DGC Asia', city: 'Asia', country: 'Asia' },
  { name: 'DGC Europe', city: 'Europe', country: 'Europe' },
  { name: 'DGC North America', city: 'North America', country: 'North America' },
  { name: 'DGC South America', city: 'South America', country: 'South America' },
];

// Same list every branch gets when seeded — keep in sync with prisma/seed.ts BRANCH_SECTIONS.
const BRANCH_SECTIONS = [
  { name: 'General Chat', isReadOnly: false },
  { name: 'Prayer Requests', isReadOnly: false },
  { name: 'Testimonies', isReadOnly: false },
  { name: 'Service Updates', isReadOnly: true }, // = branch announcement channel
  { name: 'Volunteer Opportunities', isReadOnly: false },
];

async function main() {
  for (const b of NEW_BRANCHES) {
    const branch = await prisma.branch.upsert({
      where: { name: b.name },
      update: { city: b.city, country: b.country },
      create: b,
      select: { id: true, name: true },
    });
    // Create each section channel if it doesn't already exist.
    let created = 0;
    for (const s of BRANCH_SECTIONS) {
      const existing = await prisma.channel.findFirst({
        where: { type: 'BRANCH_SECTION', branchId: branch.id, name: s.name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.channel.create({
          data: { type: 'BRANCH_SECTION', branchId: branch.id, name: s.name, isReadOnly: s.isReadOnly },
        });
        created += 1;
      }
    }
    console.log(`  ${branch.name.padEnd(28)} id=${branch.id}  channels created: ${created}`);
  }

  // Bust the branches list cache so the new set is served on the next request instead of
  // waiting up to 5 minutes for the TTL to expire.
  const redisUrl = process.env['REDIS_URL'];
  if (redisUrl) {
    try {
      const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
      await redis.del('cache:branches');
      await redis.quit();
      console.log('\n  Invalidated Redis key cache:branches');
    } catch (err) {
      console.log(`\n  Could not reach Redis (${(err as Error).message}) — cache will refresh on TTL expiry.`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
