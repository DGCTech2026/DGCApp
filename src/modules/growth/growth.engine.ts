import { prisma } from '../../infra/db';
import { growthQueue } from '../../infra/queue';
import { notificationService } from '../notifications/notifications.service';
import { logger } from '../../infra/logger';

type RequirementSource = 'AUTO' | 'SELF_ATTEST' | 'ADMIN_VERIFY' | 'CERTIFICATE';

// The growth state machine (CLAUDE.md §6.2). All transition logic lives here, in one place.
export const growthEngine = {
  // AUTO requirements fire off the request path — enqueue, the worker records + recomputes.
  async enqueueRequirement(userId: string, requirementKey: string) {
    await growthQueue.add('complete-requirement', { userId, requirementKey });
  },

  async completeRequirement(
    userId: string,
    requirementKey: string,
    source: RequirementSource,
    verifiedById?: string,
  ) {
    const requirement = await prisma.growthRequirement.findUnique({
      where: { key: requirementKey },
      select: { id: true },
    });
    if (!requirement) {
      logger.warn({ requirementKey }, 'completeRequirement: unknown requirement key');
      return;
    }
    await this.completeRequirementById(userId, requirement.id, source, verifiedById);
  },

  async completeRequirementById(
    userId: string,
    requirementId: string,
    source: RequirementSource,
    verifiedById?: string,
  ) {
    await prisma.requirementCompletion.upsert({
      where: { userId_requirementId: { userId, requirementId } },
      create: { userId, requirementId, source, verifiedById: verifiedById ?? null },
      update: {}, // already complete — idempotent
    });
    await this.recompute(userId);
  },

  // Derive the current stage from completed requirements, advance, award badges, notify on advance.
  // Idempotent: always recomputes from the full completion set, so retries/duplicates are safe.
  async recompute(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { currentStageId: true } });
    if (!user) return;

    const [stages, completions, badges] = await Promise.all([
      prisma.growthStage.findMany({
        orderBy: { order: 'asc' },
        select: { id: true, key: true, name: true, order: true, requirements: { select: { id: true } } },
      }),
      prisma.requirementCompletion.findMany({ where: { userId }, select: { requirementId: true } }),
      prisma.badge.findMany({ select: { id: true, key: true } }),
    ]);
    if (stages.length === 0) return;

    const done = new Set(completions.map((c) => c.requirementId));
    const badgeByKey = new Map(badges.map((b) => [b.key, b.id]));
    const stageComplete = (s: (typeof stages)[number]) =>
      s.requirements.length > 0 && s.requirements.every((r) => done.has(r.id));

    // Current stage = the lowest-order stage not yet fully complete (or the last stage if all done).
    let current = stages[stages.length - 1]!;
    for (const s of stages) {
      if (!stageComplete(s)) {
        current = s;
        break;
      }
    }

    // Award the badge for every fully-complete stage whose key matches a badge (idempotent).
    for (const s of stages) {
      const badgeId = badgeByKey.get(s.key);
      if (badgeId && stageComplete(s)) {
        await prisma.userBadge.upsert({
          where: { userId_badgeId: { userId, badgeId } },
          create: { userId, badgeId },
          update: {},
        });
      }
    }

    if (current.id !== user.currentStageId) {
      await prisma.user.update({ where: { id: userId }, data: { currentStageId: current.id } });
      await notificationService
        .notify(userId, {
          type: 'GROWTH',
          title: 'Growth milestone',
          body: `You've advanced to ${current.name}!`,
          data: { stageKey: current.key },
        })
        .catch(() => {}); // notification is best-effort; never fail the transition on it
    }
  },
};
