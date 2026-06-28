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
  { name: 'DGC Abuja', city: 'Abuja', country: 'Nigeria' },
  { name: 'DGC Lagos', city: 'Lagos', country: 'Nigeria' },
  { name: 'DGC Ibadan', city: 'Ibadan', country: 'Nigeria' },
  { name: 'DGC Port Harcourt', city: 'Port Harcourt', country: 'Nigeria' },
  { name: 'DGC United Kingdom', city: 'London', country: 'United Kingdom' },
  { name: 'DGC Australia', city: 'Sydney', country: 'Australia' },
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

const STAGES: {
  key: GrowthStageKey;
  order: number;
  name: string;
  requirements: { key: string; label: string; type: RequirementType }[];
}[] = [
  { key: 'FIRST_TIMER', order: 1, name: 'First Timer', requirements: [
    { key: 'CREATE_ACCOUNT', label: 'Create account', type: 'AUTO' },
    { key: 'JOIN_BRANCH', label: 'Join a branch', type: 'AUTO' },
    { key: 'NEW_MEMBER_FORM', label: 'Complete New Member Form', type: 'SELF_ATTEST' },
    { key: 'ATTEND_FIRST_SERVICE', label: 'Attend first service', type: 'ADMIN_VERIFY' },
    { key: 'WATCH_WELCOME_VIDEO', label: 'Watch Welcome Video', type: 'SELF_ATTEST' },
  ]},
  { key: 'NEW_MEMBER', order: 2, name: 'New Member', requirements: [
    { key: 'JOIN_CLUSTER', label: 'Join at least one cluster', type: 'AUTO' },
  ]},
  { key: 'FOUNDATIONS_GRADUATE', order: 3, name: 'Foundations School Graduate', requirements: [
    { key: 'FOUNDATIONS_CERT_VERIFIED', label: 'Foundations School certificate verified', type: 'CERTIFICATE' },
    { key: 'FOUNDATIONS_ASSESSMENT', label: 'Pass assessment', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'WORKER', order: 4, name: 'Worker', requirements: [
    { key: 'JOIN_SERVICE_UNIT', label: 'Join a service unit', type: 'AUTO' },
    { key: 'JOIN_PRAYER_CHAIN', label: 'Join a prayer chain', type: 'AUTO' },
    { key: 'ATTEND_REGULARLY', label: 'Attend services regularly', type: 'ADMIN_VERIFY' },
    { key: 'SERVE_MIN_DURATION', label: 'Serve for a minimum duration', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'EMERGING_LEADER', order: 5, name: 'Emerging Leader', requirements: [
    { key: 'SOM_CERT_VERIFIED', label: 'Complete SOM (certificate verified)', type: 'CERTIFICATE' },
    { key: 'GOOD_STANDING_REC', label: 'Good standing recommendation', type: 'ADMIN_VERIFY' },
    { key: 'CONSISTENT_SERVICE', label: 'Consistent service record', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'CELL_LEADER', order: 6, name: 'Cell Leader', requirements: [
    { key: 'LEAD_CELL_GROUP', label: 'Lead a cell group', type: 'ADMIN_VERIFY' },
    { key: 'SUBMIT_MONTHLY_REPORTS', label: 'Submit monthly reports', type: 'AUTO' },
    { key: 'MENTOR_MEMBERS', label: 'Mentor members', type: 'AUTO' },
  ]},
  { key: 'ADVANCED_SOM_GRADUATE', order: 7, name: 'Advanced SOM Graduate', requirements: [
    { key: 'ADV_SOM_CERT_VERIFIED', label: 'Complete Advanced SOM (certificate verified)', type: 'CERTIFICATE' },
    { key: 'ADV_SOM_ASSESSMENT', label: 'Pass assessments', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'MINISTRY_LEADER', order: 8, name: 'Ministry Leader', requirements: [
    { key: 'LEAD_DEPARTMENT', label: 'Lead a department', type: 'ADMIN_VERIFY' },
    { key: 'TRAIN_WORKERS', label: 'Train workers', type: 'ADMIN_VERIFY' },
    { key: 'DEMONSTRATE_CONSISTENCY', label: 'Demonstrate consistency', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'PASTORATE_CANDIDATE', order: 9, name: 'Pastorate Candidate', requirements: [
    { key: 'LEADERSHIP_RECOMMENDATION', label: 'Recommendation from leadership', type: 'ADMIN_VERIFY' },
    { key: 'COMPLETE_REQUIRED_TRAINING', label: 'Complete required training', type: 'ADMIN_VERIFY' },
    { key: 'LEADERSHIP_REVIEW', label: 'Leadership review', type: 'ADMIN_VERIFY' },
  ]},
  { key: 'PASTORATE', order: 10, name: 'Pastorate', requirements: [
    { key: 'SPIRITUAL_OVERSIGHT_APPROVAL', label: 'Spiritual oversight approval', type: 'ADMIN_VERIFY' },
  ]},
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

  for (const branch of branches) {
    for (const section of BRANCH_SECTIONS) {
      await findOrCreateChannel(
        { type: 'BRANCH_SECTION', branchId: branch.id, name: section },
        { type: 'BRANCH_SECTION', branchId: branch.id, name: section },
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
