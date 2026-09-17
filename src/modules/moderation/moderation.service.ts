import { prisma } from '../../infra/db';
import { NotFound, BadRequest, Conflict } from '../../utils/errors';
import { logger } from '../../infra/logger';
import type { ReportMessageInput, ReportUserInput } from './moderation.schema';

export const moderationService = {
  // ── Reports ──────────────────────────────────────────────────────────────

  async reportMessage(reporterId: string, messageId: string, input: ReportMessageInput) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, senderId: true, channelId: true, deletedAt: true },
    });
    if (!message || message.deletedAt) throw NotFound('Message not found');
    if (message.senderId === reporterId) throw BadRequest('You cannot report your own message');

    const existing = await prisma.report.findFirst({
      where: { reporterId, targetType: 'MESSAGE', targetId: messageId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) throw Conflict('You have already reported this message');

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType: 'MESSAGE',
        targetId: messageId,
        reason: input.reason,
        details: input.details ?? null,
      },
    });
    logger.info({ reportId: report.id, reporterId, messageId }, 'Message reported');
    return { ok: true, reportId: report.id };
  },

  async reportUser(reporterId: string, targetUserId: string, input: ReportUserInput) {
    if (targetUserId === reporterId) throw BadRequest('You cannot report yourself');

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw NotFound('User not found');

    const existing = await prisma.report.findFirst({
      where: { reporterId, targetType: 'USER', targetId: targetUserId, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) throw Conflict('You have already reported this user');

    const report = await prisma.report.create({
      data: {
        reporterId,
        targetType: 'USER',
        targetId: targetUserId,
        reason: input.reason,
        details: input.details ?? null,
      },
    });
    logger.info({ reportId: report.id, reporterId, targetUserId }, 'User reported');
    return { ok: true, reportId: report.id };
  },

  // ── Blocking ─────────────────────────────────────────────────────────────

  async blockUser(blockerId: string, blockedId: string) {
    if (blockedId === blockerId) throw BadRequest('You cannot block yourself');

    const target = await prisma.user.findUnique({
      where: { id: blockedId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt) throw NotFound('User not found');

    await prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    });
    return { ok: true };
  },

  async unblockUser(blockerId: string, blockedId: string) {
    await prisma.userBlock.deleteMany({ where: { blockerId, blockedId } });
    return { ok: true };
  },

  async listBlocked(userId: string) {
    const blocks = await prisma.userBlock.findMany({
      where: { blockerId: userId },
      select: {
        blockedId: true,
        createdAt: true,
        blocked: { select: { id: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return blocks.map((b) => ({ ...b.blocked, blockedAt: b.createdAt }));
  },

  async getBlockedIds(userId: string): Promise<Set<string>> {
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    });
    return new Set(rows.map((r) => r.blockedId));
  },

  // ── Admin: report management ─────────────────────────────────────────────

  async listReports(status?: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED', limit = 50) {
    return prisma.report.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        targetType: true,
        targetId: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        resolvedAt: true,
        reporter: { select: { id: true, displayName: true } },
      },
    });
  },

  async resolveReport(reportId: string, handledById: string, status: 'RESOLVED' | 'DISMISSED') {
    const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true } });
    if (!report) throw NotFound('Report not found');
    await prisma.report.update({
      where: { id: reportId },
      data: { status, handledById, resolvedAt: new Date() },
    });
    return { ok: true };
  },
};
