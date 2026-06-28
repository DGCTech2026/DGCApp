import { prisma } from '../../infra/db';
import { NotFound } from '../../utils/errors';

export const clusterService = {
  // Recommended Clusters list — all active clusters, flagged with whether the user has joined.
  async list(userId: string) {
    const [clusters, mine] = await Promise.all([
      prisma.cluster.findMany({
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
      }),
      prisma.clusterMembership.findMany({ where: { userId }, select: { clusterId: true } }),
    ]);
    const mineSet = new Set(mine.map((m) => m.clusterId));
    return clusters.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      isDefault: c.isDefault,
      memberCount: c._count.memberships,
      isMember: mineSet.has(c.id),
    }));
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
    // TODO(growth): JOIN_CLUSTER is an AUTO requirement (Stage 2) — enqueue a growth recompute (§6.2).
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
    return { ok: true };
  },
};
