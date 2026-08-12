// One-off: delete GrowthRequirement rows that no longer appear in the seed after the
// 2026-08-12 restructure. Cascade drops their RequirementCompletion rows too so no user
// is stuck holding "completions" for requirements that don't exist any more.
// After running this + re-seeding, recompute every user so their currentStageId reflects
// the new pipeline (users who had completed old FIRST_TIMER reqs but not the new photo
// upload will be pulled back to FIRST_TIMER — correct behavior).
//
// Run:  npx tsx -r dotenv/config scripts/cleanup-old-growth-requirements.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { growthEngine } from '../src/modules/growth/growth.engine';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Keys that were in the old seed but are NOT in the new seed.
const REMOVED_KEYS = [
  'CREATE_ACCOUNT',
  'JOIN_BRANCH',
  'NEW_MEMBER_FORM',
  'ATTEND_FIRST_SERVICE',
  'WATCH_WELCOME_VIDEO',
  'JOIN_CLUSTER',
  'JOIN_SERVICE_UNIT',
  'JOIN_PRAYER_CHAIN',
  'ATTEND_REGULARLY',
  'SERVE_MIN_DURATION',
];

async function main() {
  const before = await prisma.growthRequirement.findMany({
    where: { key: { in: REMOVED_KEYS } },
    select: { key: true, _count: { select: { completions: true } } },
  });
  if (!before.length) {
    console.log('Nothing to clean up — no old requirements found.');
  } else {
    console.log(`Removing ${before.length} old requirement(s):`);
    for (const r of before) console.log(`  - ${r.key} (${r._count.completions} completion(s))`);
    const res = await prisma.growthRequirement.deleteMany({ where: { key: { in: REMOVED_KEYS } } });
    console.log(`Deleted ${res.count} requirement rows (completions cascaded).`);
  }

  console.log('\nRecomputing every non-deleted user…');
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
  let done = 0;
  for (const u of users) {
    await growthEngine.recompute(u.id);
    done++;
    if (done % 25 === 0) console.log(`  …${done}/${users.length}`);
  }
  console.log(`Recomputed ${done} user(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
