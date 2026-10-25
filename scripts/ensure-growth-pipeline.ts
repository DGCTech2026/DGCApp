// Ensures the growth pipeline in the database exactly matches src/modules/growth/pipeline.ts:
//   - The ten app stages exist with the correct order and display name
//   - Every task exists and is linked to the right stage
//   - Any stage or requirement with an unknown key is deleted; user pointers into those
//     deleted stages are nullified first so the FK holds
//   - Account, branch, and cluster steps already done are recorded, then every member is
//     stood in the furthest room those papers open. No push is sent for that move.
//
// Idempotent. Safe to run repeatedly. Use this after a pipeline change instead of
// `prisma db seed` (which would also re-touch branches/clusters/channels).
//
// Run:  npx tsx -r dotenv/config scripts/ensure-growth-pipeline.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { GROWTH_STAGES } from '../src/modules/growth/pipeline';
import { placeMember } from '../src/modules/growth/place';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const STAGES = GROWTH_STAGES;

async function recordAuto(requirementKey: string, userIds: string[]) {
  if (!userIds.length) return;
  const req = await prisma.growthRequirement.findUnique({ where: { key: requirementKey }, select: { id: true } });
  if (!req) return;
  for (let i = 0; i < userIds.length; i += 500) {
    const slice = userIds.slice(i, i + 500);
    await prisma.requirementCompletion.createMany({
      data: slice.map((userId) => ({ userId, requirementId: req.id, source: 'AUTO' as const })),
      skipDuplicates: true,
    });
  }
  console.log(`  ${requirementKey}: marked done for ${userIds.length} member(s) who already did it`);
}

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

  // 6. Steps the app already did before these tasks existed: an account, a branch, a cluster.
  // Without this, recompute would stand every existing member back at First Timer.
  console.log('\nRecording steps members have already finished…');
  const members = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
  const branchMembers = await prisma.branchMembership.findMany({
    where: { user: { deletedAt: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  const clusterMembers = await prisma.clusterMembership.findMany({
    where: { user: { deletedAt: null } },
    select: { userId: true },
    distinct: ['userId'],
  });
  await recordAuto('CREATE_ACCOUNT', members.map((u) => u.id));
  await recordAuto('JOIN_BRANCH', branchMembers.map((m) => m.userId));
  await recordAuto('JOIN_CLUSTER', clusterMembers.map((m) => m.userId));

  // 7. Recompute every non-deleted user. Idempotent; batched to keep memory flat on Render's
  // starter instance. notify is off so this backfill does not push the whole membership.
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
      await placeMember(prisma, u.id);
    }
    done += batch.length;
    cursor = batch[batch.length - 1]!.id;
    if (done % 500 === 0 || batch.length < 100) console.log(`  …${done}/${total}`);
    if (batch.length < 100) break;
  }
  console.log(`\n✓ Done. Pipeline is in sync with the ten app stages.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
