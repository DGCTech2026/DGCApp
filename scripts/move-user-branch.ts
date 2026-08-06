// Move a user between branches. Full transaction: swap BranchMembership + all their
// ChannelMembership rows for the old branch's section channels → new branch's section channels.
// Old messages stay in DB but the user loses access (chat.list gates on membership).
// Run: npx tsx -r dotenv/config scripts/move-user-branch.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const USER_EMAIL = 'ipy06official@gmail.com';
const TARGET_BRANCH_NAME = 'DGC North America';

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL.trim().toLowerCase() },
    select: {
      id: true, email: true, displayName: true, deletedAt: true,
      branchMemberships: { select: { branchId: true, branch: { select: { id: true, name: true } } } },
    },
  });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);
  if (user.deletedAt) throw new Error(`User is soft-deleted: ${USER_EMAIL}`);
  console.log(`User: ${user.email} — ${user.displayName ?? 'no name'} (id=${user.id})`);
  console.log(`  Current branches: ${user.branchMemberships.map((m) => m.branch.name).join(', ') || '(none)'}`);

  const target = await prisma.branch.findUnique({
    where: { name: TARGET_BRANCH_NAME },
    select: { id: true, name: true },
  });
  if (!target) throw new Error(`Target branch not found: ${TARGET_BRANCH_NAME}`);
  console.log(`Target: ${target.name} (id=${target.id})`);

  if (user.branchMemberships.some((m) => m.branchId === target.id)) {
    console.log('\n  Nothing to do — user already in the target branch.');
    return;
  }

  // Old branch section-channel ids (to remove ChannelMembership rows from). We only touch
  // BRANCH_SECTION channels — DM, cluster, and global channel memberships stay untouched.
  const oldBranchIds = user.branchMemberships.map((m) => m.branchId);
  const oldChannels = oldBranchIds.length
    ? await prisma.channel.findMany({
        where: { type: 'BRANCH_SECTION', branchId: { in: oldBranchIds } },
        select: { id: true },
      })
    : [];
  const oldChannelIds = oldChannels.map((c) => c.id);

  // Target branch section-channel ids (to add ChannelMembership rows for).
  const newChannels = await prisma.channel.findMany({
    where: { type: 'BRANCH_SECTION', branchId: target.id },
    select: { id: true },
  });
  const newChannelIds = newChannels.map((c) => c.id);
  console.log(`  Removing ${oldChannelIds.length} old channel memberships, adding ${newChannelIds.length} new ones`);

  await prisma.$transaction(async (tx) => {
    if (oldChannelIds.length) {
      await tx.channelMembership.deleteMany({
        where: { userId: user.id, channelId: { in: oldChannelIds } },
      });
    }
    await tx.branchMembership.deleteMany({ where: { userId: user.id } });
    await tx.branchMembership.create({
      data: { userId: user.id, branchId: target.id, role: 'MEMBER' },
    });
    if (newChannelIds.length) {
      await tx.channelMembership.createMany({
        data: newChannelIds.map((channelId) => ({ userId: user.id, channelId })),
        skipDuplicates: true,
      });
    }
  }, { timeout: 20000, maxWait: 10000 });

  console.log('\n  Done. Verifying…');
  const after = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      branchMemberships: { select: { branch: { select: { name: true } } } },
      channelMemberships: {
        where: { channel: { type: 'BRANCH_SECTION', branchId: target.id } },
        select: { channel: { select: { name: true } } },
      },
    },
  });
  console.log(`  Branches now: ${after!.branchMemberships.map((m) => m.branch.name).join(', ')}`);
  console.log(`  Target-branch channels joined: ${after!.channelMemberships.map((c) => c.channel.name).join(', ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
