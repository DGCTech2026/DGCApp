import { prisma } from '../../infra/db';

// Read-only "My Journey" summary. The full transition engine (firing requirement completions,
// advancing stages) is a later slice — for now this reports the user's current stage, the ordered
// pipeline, and the current stage's requirements with completion flags.
export const growthService = {
  async getMySummary(userId: string) {
    const [user, stages, completions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currentStageId: true } }),
      prisma.growthStage.findMany({
        orderBy: { order: 'asc' },
        select: { id: true, key: true, name: true, order: true },
      }),
      prisma.requirementCompletion.findMany({ where: { userId }, select: { requirementId: true } }),
    ]);

    const current = stages.find((s) => s.id === user.currentStageId) ?? stages[0];
    const currentOrder = current?.order ?? 1;
    const total = stages.length || 1;

    const currentReqs = current
      ? await prisma.growthRequirement.findMany({
          where: { stageId: current.id },
          orderBy: { key: 'asc' },
          select: { id: true, key: true, label: true, type: true },
        })
      : [];
    const doneSet = new Set(completions.map((c) => c.requirementId));
    const requirements = currentReqs.map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type,
      completed: doneSet.has(r.id),
    }));

    const nextStage = stages.find((s) => s.order === currentOrder + 1) ?? null;
    const nextIncomplete = requirements.find((r) => !r.completed);

    return {
      currentStage: current ? { key: current.key, name: current.name, order: current.order } : null,
      progressPercent: Math.round((currentOrder / total) * 100),
      nextStage: nextStage ? { key: nextStage.key, name: nextStage.name, order: nextStage.order } : null,
      nextAction:
        nextIncomplete?.label ?? (nextStage ? `Advance to ${nextStage.name}` : 'You have reached the final stage'),
      stages: stages.map((s) => ({
        key: s.key,
        name: s.name,
        order: s.order,
        reached: s.order <= currentOrder,
        isCurrent: s.id === current?.id,
      })),
      currentStageRequirements: requirements,
    };
  },
};
