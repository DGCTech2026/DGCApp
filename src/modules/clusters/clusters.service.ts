import { prisma } from '../../infra/db';
import { NotFound, Forbidden } from '../../utils/errors';
import { growthEngine } from '../growth/growth.engine';
import { cached, cacheKeys, invalidate } from '../../infra/cache';
import { joinChannelRoom, leaveChannelRoom } from '../../infra/realtime';

// Minimum growth-stage order a member must be at to opt into a cluster. WORKER is order 4 —
// they must have gone through First Timer → New Member → Foundations Graduate → Worker first.
// Rationale: clusters are ministry teams; joining them assumes you've completed the onboarding
// path. SUPER_ADMIN bypasses this check.
const MIN_CLUSTER_JOIN_STAGE_ORDER = 4;

export const clusterService = {
  // Recommended Clusters list — all active clusters, flagged with whether the user has joined.
  // The catalogue (names + counts) is cached and shared; isMember is merged live per caller.
  async list(userId: string) {
    const [clusters, mine] = await Promise.all([
      cached(
        cacheKeys.clusters,
        10,
        async () => {
          const rows = await prisma.cluster.findMany({
            where: { archivedAt: null },
            orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
            select: {
              id: true,
              slug: true,
              name: true,
              description: true,
              isDefault: true,
              _count: { select: { memberships: true } },
            },
          });
          return rows.map((c) => ({
            id: c.id,
            slug: c.slug,
            name: c.name,
            description: c.description,
            isDefault: c.isDefault,
            memberCount: c._count.memberships,
          }));
        },
        // Same reason as branches: catalogue should never legitimately be empty; don't cache empty.
        { skipCacheIfEmpty: true },
      ),
      prisma.clusterMembership.findMany({ where: { userId }, select: { clusterId: true } }),
    ]);
    const mineSet = new Set(mine.map((m) => m.clusterId));
    return clusters.map((c) => ({ ...c, isMember: mineSet.has(c.id) }));
  },

  async join(userId: string, role: string, clusterId: string) {
    // Gate: users must be at WORKER stage (order 4) or higher before joining any cluster.
    // Super admins bypass. Load the user's currentStage.order once — if they haven't advanced
    // yet, tell them what to do next in the error message so the frontend can render it verbatim.
    if (role !== 'SUPER_ADMIN') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { currentStage: { select: { order: true, name: true } } },
      });
      const currentOrder = user?.currentStage?.order ?? 1;
      if (currentOrder < MIN_CLUSTER_JOIN_STAGE_ORDER) {
        const currentName = user?.currentStage?.name ?? 'First Timer';
        throw Forbidden(
          `You need to reach the Worker stage before joining a cluster. You're currently at ${currentName}. Complete your onboarding steps (upload your service photo and unit-leader letter) and your Foundations School certificate to advance.`,
        );
      }
    }

    const cluster = await prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { id: true, archivedAt: true },
    });
    if (!cluster || cluster.archivedAt) throw NotFound('Cluster not found');

    const existing = await prisma.clusterMembership.findUnique({
      where: { userId_clusterId: { userId, clusterId } },
    });
    if (existing) return { ok: true }; // idempotent

    const channel = await prisma.channel.findFirst({
      where: { type: 'CLUSTER', clusterId },
      select: { id: true },
    });

    await prisma.$transaction(
      async (tx) => {
        await tx.clusterMembership.create({ data: { userId, clusterId, role: 'MEMBER' } });
        if (channel) {
          await tx.channelMembership.upsert({
            where: { userId_channelId: { userId, channelId: channel.id } },
            create: { userId, channelId: channel.id },
            update: {},
          });
        }
      },
      { timeout: 15000, maxWait: 8000 },
    );
    await invalidate(
      cacheKeys.clusters,
      ...(channel ? [cacheKeys.channelMembers(channel.id), cacheKeys.channelMeta(channel.id)] : []),
    );
    if (channel) joinChannelRoom(userId, channel.id);
    await growthEngine.enqueueRequirement(userId, 'JOIN_CLUSTER'); // AUTO (New Member, §11)
    return { ok: true };
  },

  async leave(userId: string, clusterId: string) {
    const channel = await prisma.channel.findFirst({
      where: { type: 'CLUSTER', clusterId },
      select: { id: true },
    });
    await prisma.$transaction(
      async (tx) => {
        await tx.clusterMembership.deleteMany({ where: { userId, clusterId } });
        if (channel) await tx.channelMembership.deleteMany({ where: { userId, channelId: channel.id } });
      },
      { timeout: 15000, maxWait: 8000 },
    );
    await invalidate(
      cacheKeys.clusters,
      ...(channel ? [cacheKeys.channelMembers(channel.id), cacheKeys.channelMeta(channel.id)] : []),
    );
    if (channel) leaveChannelRoom(userId, channel.id);
    return { ok: true };
  },
};
