import { prisma } from '../../infra/db';
import { NotFound } from '../../utils/errors';
import type { CreateBranchInput } from './admin.schema';

const BRANCH_SECTIONS = [
  'General Chat',
  'Prayer Requests',
  'Testimonies',
  'Service Updates',
  'Volunteer Opportunities',
];

export const adminService = {
  // Dashboard analytics (§13): headline counts + branch + leadership-pipeline breakdowns.
  async analytics() {
    const [totalUsers, suspendedUsers, byBranch, byStage, totalEvents, totalMessages, branches, stages] =
      await Promise.all([
        prisma.user.count({ where: { deletedAt: null } }),
        prisma.user.count({ where: { suspendedAt: { not: null } } }),
        prisma.branchMembership.groupBy({ by: ['branchId'], _count: true }),
        prisma.user.groupBy({ by: ['currentStageId'], _count: true }),
        prisma.event.count(),
        prisma.message.count({ where: { deletedAt: null } }),
        prisma.branch.findMany({ select: { id: true, name: true } }),
        prisma.growthStage.findMany({ orderBy: { order: 'asc' }, select: { id: true, name: true } }),
      ]);

    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    return {
      totalUsers,
      suspendedUsers,
      totalEvents,
      totalMessages,
      byBranch: byBranch.map((r) => ({ branch: branchName.get(r.branchId) ?? r.branchId, members: r._count })),
      leadershipPipeline: stages.map((s) => ({
        stage: s.name,
        count: byStage.find((r) => r.currentStageId === s.id)?._count ?? 0,
      })),
    };
  },

  async listUsers(search?: string, limit = 50) {
    return prisma.user.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { displayName: { contains: search, mode: 'insensitive' } },
                { phoneNumber: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        displayName: true,
        globalRole: true,
        suspendedAt: true,
        createdAt: true,
        currentStage: { select: { name: true } },
        branchMemberships: { select: { role: true, branch: { select: { name: true } } } },
      },
    });
  },

  async setSuspended(userId: string, suspended: boolean) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw NotFound('User not found');
    await prisma.user.update({ where: { id: userId }, data: { suspendedAt: suspended ? new Date() : null } });
    return { ok: true };
  },

  async setRole(userId: string, role: 'MEMBER' | 'SUPER_ADMIN') {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw NotFound('User not found');
    await prisma.user.update({ where: { id: userId }, data: { globalRole: role } });
    return { ok: true };
  },

  // Create a branch and auto-provision its section channels (PRD §2/§5).
  async createBranch(input: CreateBranchInput) {
    const branch = await prisma.branch.create({
      data: { name: input.name, city: input.city, country: input.country ?? 'Nigeria' },
    });
    await prisma.channel.createMany({
      data: BRANCH_SECTIONS.map((name) => ({ type: 'BRANCH_SECTION' as const, branchId: branch.id, name })),
    });
    return branch;
  },

  async assignBranchAdmin(branchId: string, userId: string) {
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
    if (!branch) throw NotFound('Branch not found');
    await prisma.branchMembership.upsert({
      where: { userId_branchId: { userId, branchId } },
      create: { userId, branchId, role: 'ADMIN' },
      update: { role: 'ADMIN' },
    });
    return { ok: true };
  },

  async setClusterArchived(clusterId: string, archived: boolean) {
    const c = await prisma.cluster.findUnique({ where: { id: clusterId }, select: { id: true } });
    if (!c) throw NotFound('Cluster not found');
    await prisma.cluster.update({ where: { id: clusterId }, data: { archivedAt: archived ? new Date() : null } });
    return { ok: true };
  },
};
