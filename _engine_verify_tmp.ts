import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { growthEngine } from './src/modules/growth/growth.engine';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'], ssl: { rejectUnauthorized: false } });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  cond ? pass++ : fail++;
}
async function stageKey(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currentStage: { select: { key: true } } } });
  return u.currentStage?.key;
}

const email = `engine-${Date.now()}@dgc.test`;

async function main() {
  const firstTimer = await prisma.growthStage.findUniqueOrThrow({ where: { key: 'FIRST_TIMER' } });
  const user = await prisma.user.create({ data: { email, currentStageId: firstTimer.id }, select: { id: true } });

  // Drive the engine exactly as the worker/endpoints do.
  for (const key of ['CREATE_ACCOUNT', 'JOIN_BRANCH', 'NEW_MEMBER_FORM', 'ATTEND_FIRST_SERVICE']) {
    await growthEngine.completeRequirement(user.id, key, 'AUTO');
  }
  check('4 of 5 First Timer reqs → still First Timer', (await stageKey(user.id)) === 'FIRST_TIMER', await stageKey(user.id));

  await growthEngine.completeRequirement(user.id, 'WATCH_WELCOME_VIDEO', 'SELF_ATTEST');
  check('all 5 First Timer reqs → advance to New Member', (await stageKey(user.id)) === 'NEW_MEMBER', await stageKey(user.id));

  await growthEngine.completeRequirement(user.id, 'JOIN_CLUSTER', 'AUTO');
  check('New Member req met → advance to Foundations Graduate', (await stageKey(user.id)) === 'FOUNDATIONS_GRADUATE', await stageKey(user.id));

  await growthEngine.completeRequirement(user.id, 'FOUNDATIONS_CERT_VERIFIED', 'CERTIFICATE');
  await growthEngine.completeRequirement(user.id, 'FOUNDATIONS_ASSESSMENT', 'ADMIN_VERIFY');
  check('Foundations reqs met → advance to Worker', (await stageKey(user.id)) === 'WORKER', await stageKey(user.id));

  const badges = await prisma.userBadge.findMany({ where: { userId: user.id }, select: { badge: { select: { key: true } } } });
  check('FOUNDATIONS_GRADUATE badge awarded on stage completion', badges.some((b) => b.badge.key === 'FOUNDATIONS_GRADUATE'), badges.map((b) => b.badge.key).join(','));

  // idempotency: completing an already-done requirement doesn't regress or duplicate
  await growthEngine.completeRequirement(user.id, 'CREATE_ACCOUNT', 'AUTO');
  const completions = await prisma.requirementCompletion.count({ where: { userId: user.id } });
  check('idempotent: re-completing does not duplicate or regress', (await stageKey(user.id)) === 'WORKER' && completions === 8, `stage=${await stageKey(user.id)} completions=${completions}`);

  await prisma.user.delete({ where: { id: user.id } });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); await pool.end(); });
