// List every scoped role assignment in the system.
// Run: npx tsx -r dotenv/config scripts/list-roles.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function fmt(u: { email: string | null; displayName: string | null }) {
  return `${u.email ?? '(no email)'} — ${u.displayName ?? 'no name'}`;
}

async function main() {
  console.log('=== SUPER_ADMINs (global) ===');
  const supers = await prisma.user.findMany({
    where: { globalRole: 'SUPER_ADMIN', deletedAt: null },
    select: { email: true, displayName: true },
    orderBy: { email: 'asc' },
  });
  if (!supers.length) console.log('  (none)');
  for (const u of supers) console.log(`  - ${fmt(u)}`);

  console.log('\n=== Branch Admins (BranchMembership.role = ADMIN) ===');
  const branchAdmins = await prisma.branchMembership.findMany({
    where: { role: 'ADMIN' },
    select: {
      user: { select: { email: true, displayName: true, deletedAt: true } },
      branch: { select: { name: true } },
    },
    orderBy: [{ branch: { name: 'asc' } }, { user: { email: 'asc' } }],
  });
  const activeBA = branchAdmins.filter((b) => !b.user.deletedAt);
  if (!activeBA.length) console.log('  (none)');
  for (const b of activeBA) console.log(`  - ${b.branch.name}: ${fmt(b.user)}`);

  console.log('\n=== Cluster Moderators (ClusterMembership.role = MODERATOR) ===');
  const clusterMods = await prisma.clusterMembership.findMany({
    where: { role: 'MODERATOR' },
    select: {
      user: { select: { email: true, displayName: true, deletedAt: true } },
      cluster: { select: { name: true, slug: true } },
    },
    orderBy: [{ cluster: { name: 'asc' } }, { user: { email: 'asc' } }],
  });
  const activeCM = clusterMods.filter((c) => !c.user.deletedAt);
  if (!activeCM.length) console.log('  (none)');
  for (const c of activeCM) console.log(`  - ${c.cluster.name} (${c.cluster.slug}): ${fmt(c.user)}`);

  console.log('\n=== Announcement Admins (Global Announcement channel members with ADMIN/MODERATOR role) ===');
  const globalCh = await prisma.channel.findFirst({ where: { type: 'GLOBAL_ANNOUNCEMENT' }, select: { id: true } });
  if (!globalCh) console.log('  (Global Announcement channel not configured)');
  else {
    const annAdmins = await prisma.channelMembership.findMany({
      where: { channelId: globalCh.id, role: { in: ['ADMIN', 'MODERATOR'] } },
      select: {
        role: true,
        user: { select: { email: true, displayName: true, deletedAt: true } },
      },
      orderBy: { user: { email: 'asc' } },
    });
    const activeAA = annAdmins.filter((a) => !a.user.deletedAt);
    if (!activeAA.length) console.log('  (none)');
    for (const a of activeAA) console.log(`  - ${a.role}: ${fmt(a.user)}`);
  }

  console.log('\n=== Total counts ===');
  console.log(`  Super admins:         ${supers.length}`);
  console.log(`  Branch admins:        ${activeBA.length}`);
  console.log(`  Cluster moderators:   ${activeCM.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
