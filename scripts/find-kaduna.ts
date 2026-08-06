// One-off: find any Kaduna branch and count what would cascade on delete.
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const rows = await prisma.branch.findMany({
    where: { OR: [{ name: { contains: 'Kaduna', mode: 'insensitive' } }, { city: { contains: 'Kaduna', mode: 'insensitive' } }] },
    select: { id: true, name: true, city: true, country: true, createdAt: true,
      _count: { select: { memberships: true, channels: true, events: true } },
    },
  });
  if (!rows.length) { console.log('No Kaduna branch found.'); return; }
  for (const b of rows) {
    // AudioRoom has branchId but no back-relation on Branch; count separately.
    const audioRoomCount = await prisma.audioRoom.count({ where: { branchId: b.id } });
    console.log(`\n${b.name} (${b.city}, ${b.country}) — id=${b.id}`);
    console.log(`  created:     ${b.createdAt.toISOString()}`);
    console.log(`  memberships: ${b._count.memberships}`);
    console.log(`  channels:    ${b._count.channels}`);
    console.log(`  events:      ${b._count.events}`);
    console.log(`  audio rooms: ${audioRoomCount}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => { prisma.$disconnect(); pool.end(); });
