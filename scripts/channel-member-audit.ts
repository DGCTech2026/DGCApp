// Audit: where every user is. Explains why General Chat counts differ from Prayer Watch counts.
// Run: npx tsx -r dotenv/config scripts/channel-member-audit.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const totalUsers = await prisma.user.count({ where: { deletedAt: null } });
  console.log(`\n=== Total non-deleted users ===\n  ${totalUsers}\n`);

  // Users per branch (BranchMembership)
  console.log('=== Users per branch (BranchMembership) ===');
  const branches = await prisma.branch.findMany({
    select: { id: true, name: true, _count: { select: { memberships: true } } },
    orderBy: { name: 'asc' },
  });
  let branchMembershipTotal = 0;
  for (const b of branches) {
    console.log(`  ${b.name.padEnd(30)} ${b._count.memberships}`);
    branchMembershipTotal += b._count.memberships;
  }
  console.log(`  ${'—'.repeat(30)} ${'—'.repeat(4)}`);
  console.log(`  ${'TOTAL branch memberships'.padEnd(30)} ${branchMembershipTotal}`);

  // Users with NO branch assigned (OAuth signed up but never picked a branch, etc.)
  const branchless = await prisma.user.count({
    where: { deletedAt: null, branchMemberships: { none: {} } },
  });
  console.log(`\n=== Users with NO branch assigned ===\n  ${branchless}`);
  console.log(`  (these users appear in Prayer Watch but no General Chat)`);

  // General Chat member counts per branch
  console.log('\n=== "General Chat" channel members per branch ===');
  const generalChats = await prisma.channel.findMany({
    where: { type: 'BRANCH_SECTION', name: 'General Chat' },
    select: {
      id: true,
      branch: { select: { name: true } },
      _count: { select: { memberships: true } },
    },
    orderBy: { branch: { name: 'asc' } },
  });
  let generalChatTotal = 0;
  for (const c of generalChats) {
    console.log(`  ${(c.branch?.name ?? '?').padEnd(30)} ${c._count.memberships}`);
    generalChatTotal += c._count.memberships;
  }
  console.log(`  ${'—'.repeat(30)} ${'—'.repeat(4)}`);
  console.log(`  ${'TOTAL General Chat memberships'.padEnd(30)} ${generalChatTotal}`);

  // Global channels
  console.log('\n=== Global channel members ===');
  const globals = await prisma.channel.findMany({
    where: { type: { in: ['GLOBAL_ANNOUNCEMENT', 'GLOBAL_PRAYER_WATCH'] } },
    select: { name: true, type: true, _count: { select: { memberships: true } } },
  });
  for (const c of globals) {
    console.log(`  ${(c.name ?? c.type).padEnd(30)} ${c._count.memberships}`);
  }

  // Cross-check math
  console.log('\n=== Cross-check ===');
  console.log(`  Total users:                       ${totalUsers}`);
  console.log(`  Users WITH a branch:               ${totalUsers - branchless}`);
  console.log(`  Users with NO branch:              ${branchless}`);
  console.log(`  Sum of all General Chat members:   ${generalChatTotal}  (should equal "Users WITH a branch")`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
