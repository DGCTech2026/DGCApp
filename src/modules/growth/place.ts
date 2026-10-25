import type { PrismaClient } from '@prisma/client';
import { STAGE_BADGE_KEY } from './pipeline';

export type PlacementNotice = {
  title: string;
  body: string;
  data: Record<string, string>;
};

// Stand one member in the furthest room their finished tasks open, and save the medal
// for each finished room. Returns the push to send when the room changed, or null when
// they were already standing in the right room. Postgres only. No Redis.
export async function placeMember(db: PrismaClient, userId: string): Promise<PlacementNotice | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { currentStageId: true } });
  if (!user) return null;

  const [stages, completions, badges] = await Promise.all([
    db.growthStage.findMany({
      orderBy: { order: 'asc' },
      select: { id: true, key: true, name: true, order: true, requirements: { select: { id: true } } },
    }),
    db.requirementCompletion.findMany({ where: { userId }, select: { requirementId: true } }),
    db.badge.findMany({ select: { id: true, key: true, name: true, icon: true } }),
  ]);
  if (stages.length === 0) return null;

  const done = new Set(completions.map((c) => c.requirementId));
  const badgeByKey = new Map(badges.map((b) => [b.key, b]));
  const requirementsMet = (s: (typeof stages)[number]) =>
    s.requirements.length > 0 && s.requirements.every((r) => done.has(r.id));
  // Pastorate has no task. It is reached once every earlier room is finished.
  const stageComplete = (index: number) => {
    const stage = stages[index]!;
    const isLast = index === stages.length - 1;
    if (isLast && stage.requirements.length === 0) {
      return stages.slice(0, -1).every((s) => requirementsMet(s));
    }
    return requirementsMet(stage);
  };

  let currentIndex = stages.length - 1;
  for (let i = 0; i < stages.length; i++) {
    if (!stageComplete(i)) {
      currentIndex = i;
      break;
    }
  }
  const current = stages[currentIndex]!;

  for (let i = 0; i < stages.length; i++) {
    if (!stageComplete(i)) continue;
    const badgeKey = STAGE_BADGE_KEY[stages[i]!.key];
    const badge = badgeKey ? badgeByKey.get(badgeKey) : undefined;
    if (!badge) continue;
    await db.userBadge.upsert({
      where: { userId_badgeId: { userId, badgeId: badge.id } },
      create: { userId, badgeId: badge.id },
      update: {},
    });
  }

  if (current.id === user.currentStageId) return null;
  await db.user.update({ where: { id: userId }, data: { currentStageId: current.id } });

  const finishedIndex = stageComplete(currentIndex) ? currentIndex : currentIndex - 1;
  const justFinished = finishedIndex >= 0 ? stages[finishedIndex] : undefined;
  const earned =
    justFinished && stageComplete(finishedIndex)
      ? badgeByKey.get(STAGE_BADGE_KEY[justFinished.key] ?? '')
      : undefined;
  const body = !justFinished
    ? `You've advanced to ${current.name}!`
    : justFinished.id === current.id && earned
      ? `You've reached ${current.name} and earned the ${earned.name} badge ${earned.icon}`
      : earned
        ? `You've completed ${justFinished.name} and earned the ${earned.name} badge ${earned.icon}`
        : `You've advanced to ${current.name}!`;

  return {
    title: `Congratulations — you're now a ${current.name}`,
    body,
    data: {
      type: 'growth',
      notificationType: 'GROWTH',
      route: 'GROWTH',
      screen: 'MY_JOURNEY',
      clickAction: 'OPEN_GROWTH',
      deepLink: 'dgc://growth',
      stageKey: current.key,
      stageName: current.name,
      ...(justFinished ? { completedStageKey: justFinished.key, completedStageName: justFinished.name } : {}),
      ...(earned ? { badgeName: earned.name, badgeIcon: earned.icon } : {}),
    },
  };
}
