// Ensures the growth pipeline in the database exactly matches the new definition:
//   - All 10 stages exist with correct order/name
//   - Every expected requirement exists and is linked to the right stage
//   - Any requirement with an unknown key (leftover from the old seed) is deleted
//   - Every non-deleted user has their currentStageId recomputed against the corrected pipeline
//
// Idempotent. Safe to run repeatedly. Use this after a schema/seed change to production instead
// of running `prisma db seed` (which would also re-touch branches/clusters/channels).
//
// Run:  npx tsx -r dotenv/config scripts/ensure-growth-pipeline.ts
import { PrismaClient } from '@prisma/client';
import type { GrowthStageKey, RequirementType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { growthEngine } from '../src/modules/growth/growth.engine';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// The one source of truth. Mirrors prisma/seed.ts's STAGES.
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
  { key: 'FOUNDATIONS_GRADUATE', order: 3, name: 'Foundations School Graduate', requirements: [
    { key: 'FOUNDATIONS_CERT_VERIFIED', label: 'Foundations School certificate verified', type: 'CERTIFICATE' },
    { key: 'FOUNDATIONS_ASSESSMENT', label: 'Pass assessment', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'WORKER', order: 4, name: 'Worker', requirements: [
    { key: 'WORKER_SOM_CERT_VERIFIED', label: 'Upload SOM certificate (verified by admin)', type: 'CERTIFICATE' },
  ]},
  { key: 'EMERGING_LEADER', order: 5, name: 'Emerging Leader', requirements: [
    { key: 'SOM_CERT_VERIFIED', label: 'Complete SOM (certificate verified)', type: 'CERTIFICATE' },
    { key: 'GOOD_STANDING_REC', label: 'Good standing recommendation', type: 'ADMIN_VERIFY' },
    { key: 'CONSISTENT_SERVICE', label: 'Consistent service record', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'CELL_LEADER', order: 6, name: 'Cell Leader', requirements: [
    { key: 'LEAD_CELL_GROUP', label: 'Lead a cell group', type: 'ADMIN_VERIFY' },
    { key: 'SUBMIT_MONTHLY_REPORTS', label: 'Submit monthly reports', type: 'AUTO' },
    { key: 'MENTOR_MEMBERS', label: 'Mentor members', type: 'AUTO' },
  ]},
  { key: 'ADVANCED_SOM_GRADUATE', order: 7, name: 'Advanced SOM Graduate', requirements: [
    { key: 'ADV_SOM_CERT_VERIFIED', label: 'Complete Advanced SOM (certificate verified)', type: 'CERTIFICATE' },
    { key: 'ADV_SOM_ASSESSMENT', label: 'Pass assessments', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'MINISTRY_LEADER', order: 8, name: 'Ministry Leader', requirements: [
    { key: 'LEAD_DEPARTMENT', label: 'Lead a department', type: 'ADMIN_VERIFY' },
    { key: 'TRAIN_WORKERS', label: 'Train workers', type: 'ADMIN_VERIFY' },
    { key: 'DEMONSTRATE_CONSISTENCY', label: 'Demonstrate consistency', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'PASTORATE_CANDIDATE', order: 9, name: 'Pastorate Candidate', requirements: [
    { key: 'LEADERSHIP_RECOMMENDATION', label: 'Recommendation from leadership', type: 'ADMIN_VERIFY' },
    { key: 'COMPLETE_REQUIRED_TRAINING', label: 'Complete required training', type: 'ADMIN_VERIFY' },
    { key: 'LEADERSHIP_REVIEW', label: 'Leadership review', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'PASTORATE', order: 10, name: 'Pastorate', requirements: [
    { key: 'SPIRITUAL_OVERSIGHT_APPROVAL', label: 'Spiritual oversight approval', type: 'ADMIN_VERIFY' },
  ]},
];

async function main() {
  console.log('--- Growth pipeline sync ---\n');

  // 1. Upsert every stage.
  for (const s of STAGES) {
    await prisma.growthStage.upsert({
      where: { key: s.key },
      update: { order: s.order, name: s.name },
      create: { key: s.key, order: s.order, name: s.name },
    });
  }
  console.log(`Stages: ${STAGES.length} upserted`);

  // 2. Upsert every expected requirement, linked to its stage.
  const expectedKeys = new Set<string>();
  for (const s of STAGES) {
    const stage = await prisma.growthStage.findUniqueOrThrow({ where: { key: s.key }, select: { id: true } });
    for (const r of s.requirements) {
      expectedKeys.add(r.key);
      await prisma.growthRequirement.upsert({
        where: { key: r.key },
        update: { label: r.label, type: r.type, stageId: stage.id },
        create: { key: r.key, label: r.label, type: r.type, stageId: stage.id },
      });
    }
  }
  console.log(`Requirements: ${expectedKeys.size} upserted`);

  // 3. Delete any requirement whose key isn't in the expected list. Cascade drops orphaned
  // completions too — users who had "completed" a now-removed requirement lose that completion,
  // which is the correct behavior (their currentStage will be recomputed against the new rules).
  const removed = await prisma.growthRequirement.deleteMany({
    where: { key: { notIn: [...expectedKeys] } },
  });
  console.log(`Requirements removed (orphaned old ones): ${removed.count}`);

  // 4. Recompute every non-deleted user. Idempotent — a user already at the correct stage stays
  // there. Batched to keep memory flat on Render's small instance.
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
  console.log(`\n✓ Done. Growth pipeline is in sync.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
