// One-off (idempotent, safe to re-run): rewrite stored Cloudinary URLs to right-sized,
// auto-format delivery URLs. Originals in Cloudinary are untouched — this only changes which
// rendition clients download. Run: npx tsx -r dotenv/config scripts/optimize-media-urls.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { optimizeAvatar, optimizeImage } from '../src/utils/cloudinaryUrl';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const users = await prisma.user.findMany({
    where: { avatarUrl: { contains: 'res.cloudinary.com' } },
    select: { id: true, avatarUrl: true },
  });
  let avatars = 0;
  for (const u of users) {
    const next = optimizeAvatar(u.avatarUrl!);
    if (next !== u.avatarUrl) {
      await prisma.user.update({ where: { id: u.id }, data: { avatarUrl: next } });
      avatars++;
    }
  }
  console.log(`Avatars: ${users.length} Cloudinary URLs found, ${avatars} rewritten`);

  const messages = await prisma.message.findMany({
    where: { type: 'IMAGE', mediaUrl: { contains: 'res.cloudinary.com' }, deletedAt: null },
    select: { id: true, mediaUrl: true },
  });
  let images = 0;
  for (const m of messages) {
    const next = optimizeImage(m.mediaUrl!);
    if (next !== m.mediaUrl) {
      await prisma.message.update({ where: { id: m.id }, data: { mediaUrl: next } });
      images++;
    }
  }
  console.log(`Chat images: ${messages.length} Cloudinary URLs found, ${images} rewritten`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
