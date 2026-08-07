// Grant Prayer Watch moderator power to users. Under the hood this is being a MODERATOR of
// the Prayer Warriors cluster — the audio-rooms canModerateRoom() helper recognises Prayer
// Warriors mods as valid moderators for any PRAYER_WATCH-type room, including the Global
// Prayer Watch call which has no clusterId of its own.
// Run: npx tsx -r dotenv/config scripts/assign-prayer-watch-moderator.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const EMAILS = [
  'favourgregory40@gmail.com',
  'graceglobaltech46@gmail.com',
].map((e) => e.trim().toLowerCase());

const PRAYER_WARRIORS_SLUG = 'prayer-warriors';

async function main() {
  const cluster = await prisma.cluster.findUnique({
    where: { slug: PRAYER_WARRIORS_SLUG },
    select: { id: true, name: true },
  });
  if (!cluster) throw new Error(`Cluster "${PRAYER_WARRIORS_SLUG}" not found`);
  console.log(`Cluster: ${cluster.name} (id=${cluster.id})\n`);

  const users = await prisma.user.findMany({
    where: { email: { in: EMAILS }, deletedAt: null },
    select: { id: true, email: true, displayName: true },
  });
  const missing = EMAILS.filter((e) => !users.find((u) => u.email === e));
  if (missing.length) console.log(`Not found (never registered?): ${missing.join(', ')}\n`);

  for (const u of users) {
    const before = await prisma.clusterMembership.findUnique({
      where: { userId_clusterId: { userId: u.id, clusterId: cluster.id } },
      select: { role: true },
    });
    await prisma.clusterMembership.upsert({
      where: { userId_clusterId: { userId: u.id, clusterId: cluster.id } },
      create: { userId: u.id, clusterId: cluster.id, role: 'MODERATOR' },
      update: { role: 'MODERATOR' },
    });
    const change = before ? `${before.role} → MODERATOR` : 'new membership as MODERATOR';
    console.log(`  ${u.email} (${u.displayName ?? 'no name'}): ${change}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
