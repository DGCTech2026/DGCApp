// Backfill for the Global Prayer Watch channel:
// 1. Ensure the "DGC Global Prayer Watch" channel exists (creates on first run).
// 2. Give every non-deleted user a ChannelMembership in it (skipDuplicates → idempotent).
// Run: npx tsx -r dotenv/config scripts/backfill-global-prayer-watch.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const BATCH = 1000;

async function main() {
  console.log('=== Global Prayer Watch backfill ===');

  // 1. Ensure the channel exists.
  let channel = await prisma.channel.findFirst({
    where: { type: 'GLOBAL_PRAYER_WATCH' },
    select: { id: true },
  });
  if (!channel) {
    channel = await prisma.channel.create({
      data: {
        type: 'GLOBAL_PRAYER_WATCH',
        name: 'DGC Global Prayer Watch',
        description: '24hr prayer — chat here, join the live prayer call anytime.',
        isReadOnly: false,
      },
      select: { id: true },
    });
    console.log(`  Created channel id=${channel.id}`);
  } else {
    console.log(`  Channel already exists id=${channel.id}`);
  }

  // 2. Backfill memberships — cursor-paginated over User.id so we scale beyond 10k.
  let cursor: string | undefined;
  let joined = 0;
  let scanned = 0;
  for (;;) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    if (!users.length) break;
    scanned += users.length;
    const result = await prisma.channelMembership.createMany({
      data: users.map((u) => ({ userId: u.id, channelId: channel!.id, role: 'MEMBER' as const })),
      skipDuplicates: true, // idempotent — users already in the channel get skipped
    });
    joined += result.count;
    cursor = users[users.length - 1]!.id;
    if (users.length < BATCH) break;
  }
  console.log(`  Scanned ${scanned} user(s); added ${joined} new membership(s) (rest were already members).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
