import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const emails = [
  'samuelolu407@gmail.com',
];

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, displayName: true },
  });

  console.log(`Found ${users.length} of ${emails.length} users:`);
  for (const u of users) console.log(`  - ${u.email} (${u.displayName ?? 'no name'})`);

  const missing = emails.filter((e) => !users.find((u) => u.email === e));
  if (missing.length) console.log(`Not found: ${missing.join(', ')}`);

  if (!users.length) {
    console.log('Nothing to delete.');
    return;
  }

  const ids = users.map((u) => u.id);

  // Message.sender has no onDelete: Cascade — delete messages first.
  // Reactions and receipts cascade from Message, so they'll go automatically.
  const msgs = await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
  console.log(`  Deleted ${msgs.count} messages`);

  // AudioRoom.hostId and Event.createdById are plain scalars (no FK constraint),
  // but clean up any audio rooms they hosted.
  const rooms = await prisma.audioRoom.deleteMany({ where: { hostId: { in: ids } } });
  console.log(`  Deleted ${rooms.count} audio rooms`);

  // Now delete users — all other relations have onDelete: Cascade.
  const result = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${result.count} users (cascade removed all related data).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
