import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { hashValue } from '../src/utils/hash';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const DEMO_EMAIL = 'appreview@dgcglobal.org';
const DEMO_PASSWORD = 'DGCReview2026!';
const DEMO_NAME = 'Apple Reviewer';

async function main() {
  const passwordHash = await hashValue(DEMO_PASSWORD);

  // Upsert demo user
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (user) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, displayName: DEMO_NAME, deletedAt: null, suspendedAt: null },
    });
    console.log('Updated existing demo user:', user.id);
  } else {
    user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash,
        displayName: DEMO_NAME,
        globalRole: 'MEMBER',
        onboardedAt: new Date(),
      },
    });
    console.log('Created demo user:', user.id);
  }

  // ── Branch ──────────────────────────────────────────────────────────────
  const branch = await prisma.branch.findFirst({ where: { name: 'DGC Lagos' } });
  if (!branch) throw new Error('Branch "DGC Lagos" not found — run prisma/seed.ts first');

  await prisma.branchMembership.upsert({
    where: { userId_branchId: { userId: user.id, branchId: branch.id } },
    create: { userId: user.id, branchId: branch.id, role: 'MEMBER' },
    update: {},
  });

  // Join branch channels + global channels
  const branchChannels = await prisma.channel.findMany({ where: { branchId: branch.id }, select: { id: true } });
  const globalChannels = await prisma.channel.findMany({
    where: { type: { in: ['GLOBAL_ANNOUNCEMENT', 'GLOBAL_PRAYER_WATCH'] } },
    select: { id: true },
  });
  const channelIds = [...branchChannels, ...globalChannels].map((c) => c.id);
  await prisma.channelMembership.createMany({
    data: channelIds.map((channelId) => ({ userId: user!.id, channelId })),
    skipDuplicates: true,
  });
  console.log(`Joined ${channelIds.length} branch/global channels`);

  // ── Clusters ────────────────────────────────────────────────────────────
  const clusters = await prisma.cluster.findMany({ select: { id: true, name: true } });
  for (const cluster of clusters) {
    await prisma.clusterMembership.upsert({
      where: { userId_clusterId: { userId: user.id, clusterId: cluster.id } },
      create: { userId: user.id, clusterId: cluster.id, role: 'MEMBER' },
      update: {},
    });
    const clusterChannel = await prisma.channel.findFirst({
      where: { clusterId: cluster.id },
      select: { id: true },
    });
    if (clusterChannel) {
      await prisma.channelMembership.createMany({
        data: [{ userId: user.id, channelId: clusterChannel.id }],
        skipDuplicates: true,
      });
    }
  }
  console.log(`Joined ${clusters.length} clusters`);

  // ── Badges ──────────────────────────────────────────────────────────────
  const badges = await prisma.badge.findMany({ select: { id: true, key: true } });
  for (const badge of badges) {
    await prisma.userBadge.upsert({
      where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
      create: { userId: user.id, badgeId: badge.id },
      update: {},
    });
  }
  console.log(`Awarded ${badges.length} badges`);

  // ── Growth stage ────────────────────────────────────────────────────────
  const stage = await prisma.growthStage.findUnique({ where: { key: 'WORKER' } });
  if (stage) {
    await prisma.user.update({ where: { id: user.id }, data: { currentStageId: stage.id } });

    // Complete requirements for all stages up to WORKER so the growth screen looks realistic
    const stages = await prisma.growthStage.findMany({
      where: { order: { lte: stage.order } },
      select: { requirements: { select: { id: true, type: true } } },
    });
    for (const s of stages) {
      for (const req of s.requirements) {
        await prisma.requirementCompletion.upsert({
          where: { userId_requirementId: { userId: user.id, requirementId: req.id } },
          create: { userId: user.id, requirementId: req.id, source: req.type },
          update: {},
        });
      }
    }
    console.log('Set growth stage to WORKER with completed requirements');
  }

  // ── Pre-populated messages ──────────────────────────────────────────────
  // Find a branch general chat channel and a cluster channel to populate
  const generalChat = await prisma.channel.findFirst({
    where: { branchId: branch.id, name: 'General Chat' },
    select: { id: true },
  });

  const prayerChannel = await prisma.channel.findFirst({
    where: { type: 'GLOBAL_PRAYER_WATCH' },
    select: { id: true },
  });

  const sampleMessages = [
    'God is good! What a wonderful service today 🙏',
    'Looking forward to the upcoming retreat. Who else is attending?',
    'Just finished my devotional for the week. Psalm 23 hits differently every time.',
    'Happy Sunday everyone! Blessings to you all.',
    'Can someone share the link to the sermon from last week?',
  ];

  for (const channel of [generalChat, prayerChannel].filter(Boolean)) {
    for (const body of sampleMessages) {
      await prisma.message.create({
        data: { channelId: channel!.id, senderId: user.id, type: 'TEXT', body },
      });
    }
  }
  console.log('Added sample messages to channels');

  console.log('\n✅ Demo account ready for Apple Review');
  console.log(`   Email:    ${DEMO_EMAIL}`);
  console.log(`   Password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
