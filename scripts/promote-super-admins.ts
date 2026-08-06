// Promote users to SUPER_ADMIN by email. Idempotent — safe to re-run.
// Run: npx tsx -r dotenv/config scripts/promote-super-admins.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Emails are stored normalized (trim + lowercase) — match the same rule.
const emails = [
  'pelumie421@gmail.com',
  'mikun882@gmail.com',
  'folbami@gmail.com',
  'alasaoghelehappiness@gmail.com',
  'denike212@gmail.com',
].map((e) => e.trim().toLowerCase());

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, displayName: true, globalRole: true },
  });

  console.log(`Found ${users.length} of ${emails.length} users:`);
  for (const u of users) {
    console.log(`  - ${u.email} (${u.displayName ?? 'no name'}) — currently ${u.globalRole}`);
  }

  const missing = emails.filter((e) => !users.find((u) => u.email === e));
  if (missing.length) console.log(`Not found (never registered?): ${missing.join(', ')}`);

  const toPromote = users.filter((u) => u.globalRole !== 'SUPER_ADMIN');
  if (!toPromote.length) {
    console.log('\nNothing to do — all found users are already SUPER_ADMIN.');
    return;
  }

  const result = await prisma.user.updateMany({
    where: { id: { in: toPromote.map((u) => u.id) } },
    data: { globalRole: 'SUPER_ADMIN' },
  });
  console.log(`\nPromoted ${result.count} user(s) to SUPER_ADMIN.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => { prisma.$disconnect(); pool.end(); });
