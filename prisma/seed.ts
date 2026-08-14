import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import type { ChannelType, RequirementType, GrowthStageKey } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Render requires SSL on external connections. The pg driver doesn't always
// honour ?sslmode=require from the URL, so set it explicitly.
const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  ssl: { rejectUnauthorized: false },
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ---- config data (the pipeline lives here, not in code) ----

const BRANCHES = [
  // City-scoped branches
  { name: 'DGC Abuja', city: 'Abuja', country: 'Nigeria' },
  { name: 'DGC Lagos', city: 'Lagos', country: 'Nigeria' },
  { name: 'DGC Ibadan', city: 'Ibadan', country: 'Nigeria' },
  { name: 'DGC Port Harcourt', city: 'Port Harcourt', country: 'Nigeria' },
  { name: 'DGC United Kingdom', city: 'London', country: 'United Kingdom' },
  { name: 'DGC Australia', city: 'Sydney', country: 'Australia' },
  // Continental branches — for members not tied to a specific city.
  { name: 'DGC Africa', city: 'Africa', country: 'Africa' },
  { name: 'DGC Asia', city: 'Asia', country: 'Asia' },
  { name: 'DGC Europe', city: 'Europe', country: 'Europe' },
  { name: 'DGC North America', city: 'North America', country: 'North America' },
  { name: 'DGC South America', city: 'South America', country: 'South America' },
];

const BRANCH_SECTIONS = [
  'General Chat',
  'Prayer Requests',
  'Testimonies',
  'Service Updates',
  'Volunteer Opportunities',
];

const DEFAULT_CLUSTERS = [
  { slug: 'singles', name: 'Singles', description: 'Discussions for singles.' },
  { slug: 'teenagers', name: 'Teenagers', description: 'Teen-focused content.' },
  { slug: 'young-adults', name: 'Young Adults', description: 'Young professionals and students.' },
  { slug: 'relationship-advice', name: 'Relationship Advice', description: 'Counseling discussions.' },
  { slug: 'business-advice', name: 'Business Advice', description: 'Entrepreneurship and business growth.' },
  { slug: 'tech-community', name: 'Tech Community', description: 'Technology discussions.' },
  { slug: 'prayer-warriors', name: 'Prayer Warriors', description: 'Prayer-focused community.' },
  { slug: 'worship-team', name: 'Worship Team', description: 'Music and worship discussions.' },
  { slug: 'media-team', name: 'Media Team', description: 'Photography, design, video, streaming.' },
  { slug: 'missions-evangelism', name: 'Missions & Evangelism', description: 'Outreach coordination.' },
];

// The 5-stage pipeline. Removed from earlier PRD draft: FOUNDATIONS_GRADUATE,
// EMERGING_LEADER, CELL_LEADER, MINISTRY_LEADER, PASTORATE_CANDIDATE — the app UX
// and admin flow both work off these 5. The 5 removed enum values still exist in the
// GrowthStageKey enum (safe to leave — Postgres accepts unused enum values) but no rows
// are seeded for them, so /growth/me will never return them.
//
// ADVANCED_SOM_GRADUATE keeps its enum key for backward compatibility but is DISPLAYED
// as "School of Ministry Graduate" everywhere the name field is shown.
const STAGES: {
  key: GrowthStageKey;
  order: number;
  name: string;
  requirements: { key: string; label: string; type: RequirementType }[];
}[] = [
  { key: 'FIRST_TIMER', order: 1, name: 'First Timer', requirements: [
    { key: 'SERVICE_PHOTO_UPLOADED', label: 'Upload a photo of a service you attended', type: 'URL_UPLOAD' },
  ]},
  { key: 'NEW_MEMBER', order: 2, name: 'New Member', requirements: [
    { key: 'UNIT_LEADER_LETTER_UPLOADED', label: 'Upload attestation letter from your unit leader', type: 'URL_UPLOAD' },
  ]},
  // Worker's promotion is gated on the SOM (School of Ministry) certificate. Any super admin
  // verifies via the existing certificate queue → auto-promotes to School of Ministry Graduate.
  { key: 'WORKER', order: 3, name: 'Worker', requirements: [
    { key: 'WORKER_SOM_CERT_VERIFIED', label: 'Upload SOM certificate (verified by admin)', type: 'CERTIFICATE' },
  ]},
  // Renamed from "Advanced SOM Graduate" — the DGC pipeline only has one SOM tier now.
  // Enum key preserved for backward compat. To reach Pastorate, a super admin (typically
  // themselves in Pastorate) grants spiritual oversight approval.
  { key: 'ADVANCED_SOM_GRADUATE', order: 4, name: 'School of Ministry Graduate', requirements: [
    { key: 'SPIRITUAL_OVERSIGHT_APPROVAL', label: 'Spiritual oversight approval', type: 'ADMIN_VERIFY' },
  ]},
  // Final stage — no further requirements. A user landing here stays here.
  { key: 'PASTORATE', order: 5, name: 'Pastorate', requirements: [] },
];

const BADGES = [
  { key: 'FOUNDATIONS_GRADUATE', name: 'Foundations Graduate', icon: '🏅' },
  { key: 'PRAYER_CHAIN_MEMBER', name: 'Prayer Chain Member', icon: '🙏' },
  { key: 'SOM_GRADUATE', name: 'SOM Graduate', icon: '📖' },
  { key: 'ADVANCED_SOM_GRADUATE', name: 'Advanced SOM Graduate', icon: '🎓' },
  { key: 'MENTOR', name: 'Mentor', icon: '🤝' },
  { key: 'EVANGELIST', name: 'Evangelist', icon: '📢' },
  { key: 'CELL_LEADER', name: 'Cell Leader', icon: '👥' },
  { key: 'MINISTRY_LEADER', name: 'Ministry Leader', icon: '⭐' },
  { key: 'PASTORATE', name: 'Pastorate', icon: '👑' },
];

async function findOrCreateChannel(
  where: { type: ChannelType; branchId?: string; clusterId?: string; name?: string },
  data: any,
) {
  const existing = await prisma.channel.findFirst({ where });
  if (existing) return existing;
  return prisma.channel.create({ data });
}

async function main() {
  const branches = [];
  for (const b of BRANCHES) {
    branches.push(
      await prisma.branch.upsert({
        where: { name: b.name },
        update: { city: b.city, country: b.country },
        create: b,
      }),
    );
  }

  await findOrCreateChannel(
    { type: 'GLOBAL_ANNOUNCEMENT' },
    { type: 'GLOBAL_ANNOUNCEMENT', name: 'DGC Global Announcement', isReadOnly: true },
  );

  // Global Prayer Watch: singleton channel; every user is auto-joined during onboarding.
  // Chat is open (not read-only) — messages behave like any general chat channel. The live
  // prayer audio call is an AudioRoom with type=PRAYER_WATCH that anyone in this channel can start.
  await findOrCreateChannel(
    { type: 'GLOBAL_PRAYER_WATCH' },
    { type: 'GLOBAL_PRAYER_WATCH', name: 'DGC Global Prayer Watch', description: '24hr prayer — chat here, join the live prayer call anytime.', isReadOnly: false },
  );

  for (const branch of branches) {
    for (const section of BRANCH_SECTIONS) {
      await findOrCreateChannel(
        { type: 'BRANCH_SECTION', branchId: branch.id, name: section },
        { type: 'BRANCH_SECTION', branchId: branch.id, name: section, isReadOnly: section === 'Service Updates' },
      );
    }
  }

  for (const c of DEFAULT_CLUSTERS) {
    const cluster = await prisma.cluster.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description, isDefault: true },
      create: { ...c, isDefault: true },
    });
    await findOrCreateChannel(
      { type: 'CLUSTER', clusterId: cluster.id },
      { type: 'CLUSTER', clusterId: cluster.id, name: cluster.name },
    );
  }

  for (const s of STAGES) {
    const stage = await prisma.growthStage.upsert({
      where: { key: s.key },
      update: { order: s.order, name: s.name },
      create: { key: s.key, order: s.order, name: s.name },
    });
    for (const r of s.requirements) {
      await prisma.growthRequirement.upsert({
        where: { key: r.key },
        update: { label: r.label, type: r.type, stageId: stage.id },
        create: { key: r.key, label: r.label, type: r.type, stageId: stage.id },
      });
    }
  }

  for (const b of BADGES) {
    await prisma.badge.upsert({ where: { key: b.key }, update: { name: b.name, icon: b.icon }, create: b });
  }

  console.log(
    `Seeded: ${branches.length} branches, ${DEFAULT_CLUSTERS.length} clusters, ${STAGES.length} stages, ${BADGES.length} badges.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
