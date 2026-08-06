// Phase 1 role cleanup + Kaduna reassignment. Idempotent — safe to re-run.
// 1. Audit: list every current SUPER_ADMIN so we don't quietly downgrade someone we don't know about.
// 2. Move all Kaduna users to Abuja (preserves their channel memberships in Abuja's channels).
// 3. Delete Kaduna branch (cascades to its channel rows).
// 4. Downgrade the KNOWN super admins to MEMBER.
//
// Run: npx tsx -r dotenv/config scripts/phase1-role-cleanup.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// The four admins we intend to downgrade — anyone else at SUPER_ADMIN is NOT touched.
const KNOWN_ADMINS_TO_DOWNGRADE = [
  'pelumie421@gmail.com',
  'mikun882@gmail.com',
  'folbami@gmail.com',
  'alasaoghelehappiness@gmail.com',
].map((e) => e.trim().toLowerCase());

async function main() {
  // --- Audit ---
  console.log('=== Step 1: audit current SUPER_ADMINs ===');
  const admins = await prisma.user.findMany({
    where: { globalRole: 'SUPER_ADMIN' },
    select: { id: true, email: true, displayName: true },
  });
  for (const a of admins) console.log(`  - ${a.email ?? '(no email)'} (${a.displayName ?? 'no name'}) id=${a.id}`);

  const unexpected = admins.filter((a) => a.email && !KNOWN_ADMINS_TO_DOWNGRADE.includes(a.email));
  if (unexpected.length) {
    console.log(`\n  ⚠ ${unexpected.length} unexpected SUPER_ADMIN(s) present — NOT downgrading:`);
    for (const u of unexpected) console.log(`    ${u.email}`);
  }

  // --- Kaduna reassignment ---
  console.log('\n=== Step 2: move Kaduna users to Abuja ===');
  const [kaduna, abuja] = await Promise.all([
    prisma.branch.findFirst({ where: { name: { contains: 'Kaduna', mode: 'insensitive' } }, select: { id: true, name: true } }),
    prisma.branch.findFirst({ where: { name: { contains: 'Abuja', mode: 'insensitive' } }, select: { id: true, name: true } }),
  ]);
  if (!kaduna) console.log('  Kaduna not found — nothing to move.');
  else if (!abuja) console.log('  ⚠ Abuja branch not found — cannot move users. Aborting Kaduna step.');
  else {
    console.log(`  Kaduna id=${kaduna.id}  →  Abuja id=${abuja.id}`);
    const kadunaMembers = await prisma.branchMembership.findMany({
      where: { branchId: kaduna.id },
      select: { userId: true, user: { select: { email: true, displayName: true } } },
    });
    console.log(`  ${kadunaMembers.length} user(s) to reassign`);

    // Abuja's channels — every moved user gets a ChannelMembership row for each (skipDuplicates
    // handles the case where they somehow already have one).
    const abujaChannels = await prisma.channel.findMany({ where: { branchId: abuja.id }, select: { id: true } });

    for (const m of kadunaMembers) {
      const label = `${m.user.email ?? m.userId} (${m.user.displayName ?? 'no name'})`;
      // Upsert the Abuja branch membership as MEMBER (preserves any existing role if they were already there).
      await prisma.branchMembership.upsert({
        where: { userId_branchId: { userId: m.userId, branchId: abuja.id } },
        create: { userId: m.userId, branchId: abuja.id, role: 'MEMBER' },
        update: {},
      });
      await prisma.channelMembership.createMany({
        data: abujaChannels.map((c) => ({ userId: m.userId, channelId: c.id })),
        skipDuplicates: true,
      });
      console.log(`    moved: ${label}`);
    }

    // --- Delete Kaduna ---
    console.log('\n=== Step 3: delete Kaduna branch (cascades to its channels) ===');
    const deleted = await prisma.branch.delete({ where: { id: kaduna.id } });
    console.log(`  deleted branch ${deleted.name}`);
  }

  // --- Downgrade ---
  console.log('\n=== Step 4: downgrade known SUPER_ADMINs to MEMBER ===');
  const toDowngrade = admins.filter((a) => a.email && KNOWN_ADMINS_TO_DOWNGRADE.includes(a.email));
  if (!toDowngrade.length) {
    console.log('  Nothing to do — none of the known admins are currently SUPER_ADMIN.');
  } else {
    const result = await prisma.user.updateMany({
      where: { id: { in: toDowngrade.map((a) => a.id) } },
      data: { globalRole: 'MEMBER' },
    });
    console.log(`  Downgraded ${result.count} user(s):`);
    for (const a of toDowngrade) console.log(`    ${a.email}`);
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
