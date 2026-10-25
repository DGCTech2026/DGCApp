import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const SAMPLE_MESSAGES = [
  'God is good! What a wonderful service today 🙏',
  'Looking forward to the upcoming retreat. Who else is attending?',
  'Just finished my devotional for the week. Psalm 23 hits differently every time.',
  'Happy Sunday everyone! Blessings to you all.',
  'Can someone share the link to the sermon from last week?',
];

async function main() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, displayName: true },
  });
  console.log(`Found ${users.length} active users`);

  // ── Lookup data ─────────────────────────────────────────────────────────
  const clusters = await prisma.cluster.findMany({ select: { id: true, name: true } });
  const clusterChannels = new Map<string, string>();
  for (const cluster of clusters) {
    const ch = await prisma.channel.findFirst({
      where: { clusterId: cluster.id },
      select: { id: true },
    });
    if (ch) clusterChannels.set(cluster.id, ch.id);
  }

  const badges = await prisma.badge.findMany({ select: { id: true } });

  const workerStage = await prisma.growthStage.findUnique({ where: { key: 'WORKER' } });
  if (!workerStage) throw new Error('Growth stage WORKER not found — run prisma/seed.ts first');

  const stagesUpToWorker = await prisma.growthStage.findMany({
    where: { order: { lte: workerStage.order } },
    select: { requirements: { select: { id: true, type: true } } },
  });
  const requirementIds = stagesUpToWorker.flatMap((s) => s.requirements);

  const prayerChannel = await prisma.channel.findFirst({
    where: { type: 'GLOBAL_PRAYER_WATCH' },
    select: { id: true },
  });

  // ── Process each user ──────────────────────────────────────────────────
  for (const user of users) {
    console.log(`Processing ${user.displayName ?? user.id}...`);

    // Join all clusters + their channels
    for (const cluster of clusters) {
      await prisma.clusterMembership.upsert({
        where: { userId_clusterId: { userId: user.id, clusterId: cluster.id } },
        create: { userId: user.id, clusterId: cluster.id, role: 'MEMBER' },
        update: {},
      });
      const channelId = clusterChannels.get(cluster.id);
      if (channelId) {
        await prisma.channelMembership.createMany({
          data: [{ userId: user.id, channelId }],
          skipDuplicates: true,
        });
      }
    }

    // Award all badges
    for (const badge of badges) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
        create: { userId: user.id, badgeId: badge.id },
        update: {},
      });
    }

    // Set growth stage to Worker + complete prior requirements
    await prisma.user.update({
      where: { id: user.id },
      data: { currentStageId: workerStage.id },
    });
    for (const req of requirementIds) {
      await prisma.requirementCompletion.upsert({
        where: { userId_requirementId: { userId: user.id, requirementId: req.id } },
        create: { userId: user.id, requirementId: req.id, source: req.type },
        update: {},
      });
    }

    // Add sample messages to prayer watch (a channel every user is in)
    if (prayerChannel) {
      const existingMsg = await prisma.message.findFirst({
        where: { channelId: prayerChannel.id, senderId: user.id },
        select: { id: true },
      });
      if (!existingMsg) {
        const msg = SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)]!;
        await prisma.message.create({
          data: { channelId: prayerChannel.id, senderId: user.id, type: 'TEXT', body: msg },
        });
      }
    }
  }

  console.log(`\n✅ Done — ${users.length} users updated with all clusters, badges, Worker stage, and messages.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
