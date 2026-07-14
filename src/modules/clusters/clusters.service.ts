import { prisma } from '../../infra/db';
import { NotFound } from '../../utils/errors';
import { growthEngine } from '../growth/growth.engine';
import { cached, cacheKeys, invalidate } from '../../infra/cache';

export const clusterService = {
  // Recommended Clusters list — all active clusters, flagged with whether the user has joined.
  // The catalogue (names + counts) is cached and shared; isMember is merged live per caller.
  async list(userId: string) {
    const [clusters, mine] = await Promise.all([
      cached(cacheKeys.clusters, 60, async () => {
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
      }),
      prisma.clusterMembership.findMany({ where: { userId }, select: { clusterId: true } }),
    ]);
    const mineSet = new Set(mine.map((m) => m.clusterId));
    return clusters.map((c) => ({ ...c, isMember: mineSet.has(c.id) }));
  },

  async join(userId: string, clusterId: string) {
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
    return { ok: true };
  },
};
