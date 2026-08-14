// Ensures the growth pipeline in the database exactly matches the 5-stage definition:
//   - The 5 expected stages exist with correct order + display name
//   - Every expected requirement exists and is linked to the right stage
//   - Any stage or requirement with an unknown key (leftover from the earlier 10-stage draft)
//     is deleted; user pointers into those deleted stages are nullified first so the FK holds
//   - Every non-deleted user has their currentStageId recomputed against the corrected pipeline
//
// Idempotent. Safe to run repeatedly. Use this after any seed change to production instead
// of running `prisma db seed` (which would also re-touch branches/clusters/channels).
//
// Also fixes the corrupted-record case (user with currentStageId pointing at a stage that
// no longer exists) — the nullify-then-recompute step heals it automatically.
//
// Run:  npx tsx -r dotenv/config scripts/ensure-growth-pipeline.ts
import { PrismaClient } from '@prisma/client';
import type { GrowthStageKey, RequirementType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { growthEngine } from '../src/modules/growth/growth.engine';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// One source of truth. Mirrors prisma/seed.ts's STAGES. Enum keys removed from the pipeline:
// FOUNDATIONS_GRADUATE, EMERGING_LEADER, CELL_LEADER, MINISTRY_LEADER, PASTORATE_CANDIDATE.
const STAGES: {
  key: GrowthStageKey;
  order: number;
  name: string;
  requirements: { key: string; label: string; type: RequirementType }[];
}[] = [
  { key: 'FIRST_TIMER', order: 1, name: 'First Timer', requirements: [
    { key: 'SERVICE_PHOTO_UPLOADED', label: 'Upload a photo of a service you attended', type: 'URL_UPLOAD' },
  ]},
  { key: 'NEW_MEMBER', order: 2, name: 'New Member', requirements: [
    { key: 'UNIT_LEADER_LETTER_UPLOADED', label: 'Upload attestation letter from your unit leader', type: 'URL_UPLOAD' },
  ]},
  { key: 'WORKER', order: 3, name: 'Worker', requirements: [
    { key: 'WORKER_SOM_CERT_VERIFIED', label: 'Upload SOM certificate (verified by admin)', type: 'CERTIFICATE' },
  ]},
  { key: 'ADVANCED_SOM_GRADUATE', order: 4, name: 'School of Ministry Graduate', requirements: [
    { key: 'SPIRITUAL_OVERSIGHT_APPROVAL', label: 'Spiritual oversight approval', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'PASTORATE', order: 5, name: 'Pastorate', requirements: [] },
];

async function main() {
  console.log('--- Growth pipeline sync ---\n');

  const expectedStageKeys = new Set(STAGES.map((s) => s.key));

  // 1. Nullify User.currentStageId for anyone pointing at a stage we're about to delete.
  // The FK is a plain reference (no onDelete: SetNull), so we can't delete stages that still
  // have users pointing to them. This also heals "corrupted" records — users pointing at
  // a stage that no longer exists get their pointer cleared, and step 4 assigns a valid one.
  const staleStages = await prisma.growthStage.findMany({
    where: { key: { notIn: [...expectedStageKeys] } },
    select: { id: true, key: true },
  });
  if (staleStages.length) {
    const staleIds = staleStages.map((s) => s.id);
    const nullified = await prisma.user.updateMany({
      where: { currentStageId: { in: staleIds } },
      data: { currentStageId: null },
    });
    console.log(`Stale stages to remove: ${staleStages.map((s) => s.key).join(', ')}`);
    console.log(`  Nullified currentStageId on ${nullified.count} user(s) first`);
  } else {
    console.log('No stale stages to remove.');
  }

  // 2. Delete stale stages. Cascade takes their requirements and any completions with them —
  // correct behavior: a user's "completion" of a requirement whose stage no longer exists has
  // no meaning in the new pipeline.
  if (staleStages.length) {
    const del = await prisma.growthStage.deleteMany({
      where: { key: { notIn: [...expectedStageKeys] } },
    });
    console.log(`  Deleted ${del.count} stage(s) (requirements + completions cascaded)`);
  }

  // 3. Upsert every expected stage with correct order + name (safe if they already exist).
  for (const s of STAGES) {
    await prisma.growthStage.upsert({
      where: { key: s.key },
      update: { order: s.order, name: s.name },
      create: { key: s.key, order: s.order, name: s.name },
    });
  }
  console.log(`\nStages: ${STAGES.length} upserted`);

  // 4. Upsert every expected requirement, linked to its (now correctly-ordered) stage.
  const expectedReqKeys = new Set<string>();
  for (const s of STAGES) {
    const stage = await prisma.growthStage.findUniqueOrThrow({ where: { key: s.key }, select: { id: true } });
    for (const r of s.requirements) {
      expectedReqKeys.add(r.key);
      await prisma.growthRequirement.upsert({
        where: { key: r.key },
        update: { label: r.label, type: r.type, stageId: stage.id },
        create: { key: r.key, label: r.label, type: r.type, stageId: stage.id },
      });
    }
  }
  console.log(`Requirements: ${expectedReqKeys.size} upserted`);

  // 5. Delete orphaned requirements — cascade drops their completions too.
  const removedReqs = await prisma.growthRequirement.deleteMany({
    where: { key: { notIn: [...expectedReqKeys] } },
  });
  console.log(`Requirements removed (orphaned): ${removedReqs.count}`);

  // 6. Recompute every non-deleted user. Idempotent; batched to keep memory flat on Render's
  // starter instance. Users whose pointer was nullified in step 1 get a fresh valid stage now.
  const total = await prisma.user.count({ where: { deletedAt: null } });
  console.log(`\nRecomputing ${total} user(s)…`);
  let cursor: string | undefined;
  let done = 0;
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 100,
      select: { id: true },
    });
    if (!batch.length) break;
    for (const u of batch) {
      await growthEngine.recompute(u.id);
    }
    done += batch.length;
    cursor = batch[batch.length - 1]!.id;
    if (done % 500 === 0 || batch.length < 100) console.log(`  …${done}/${total}`);
    if (batch.length < 100) break;
  }
  console.log(`\n✓ Done. Pipeline is in sync with the 5-stage definition.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
