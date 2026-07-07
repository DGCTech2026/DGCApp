import { prisma } from '../../infra/db';
import { notificationQueue } from '../../infra/queue';
import { emitToChannel } from '../../infra/realtime';
import { Forbidden, NotFound } from '../../utils/errors';
import type { PostAnnouncementInput } from './announcements.schema';

// PRD §4/§3: official comms. The Global Announcement channel is org-wide; each branch's read-only
// "Service Updates" section is its branch announcement channel. Both are posted only by super admins
// + authorized posters (channel admins / branch admins) and fanned out to their members.
const ANNOUNCEMENT_SELECT = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
  sender: { select: { id: true, displayName: true, avatarUrl: true } },
  // Members can react (PRD §4) — reactions post via /messages/:id/reactions and surface here.
  reactions: { select: { emoji: true, userId: true } },
} as const;

// The branch "Service Updates" section doubles as the read-only branch announcement channel.
const BRANCH_ANNOUNCEMENT_SECTION = 'Service Updates';

async function globalChannelId(): Promise<string> {
  const ch = await prisma.channel.findFirst({ where: { type: 'GLOBAL_ANNOUNCEMENT' }, select: { id: true } });
  if (!ch) throw NotFound('Global announcement channel not found');
  return ch.id;
}

async function branchChannelId(branchId: string): Promise<string> {
  const ch = await prisma.channel.findFirst({
    where: { branchId, type: 'BRANCH_SECTION', name: BRANCH_ANNOUNCEMENT_SECTION },
    select: { id: true },
  });
  if (!ch) throw NotFound('Branch announcement channel not found');
  return ch.id;
}

// Post to an announcement channel + fan out a Notification to every member off the request path.
async function broadcast(channelId: string, userId: string, input: PostAnnouncementInput) {
  const message = await prisma.message.create({
    data: { channelId, senderId: userId, type: 'TEXT', title: input.title, body: input.body },
    select: ANNOUNCEMENT_SELECT,
  });
  emitToChannel(channelId, 'message:new', message); // live for members currently connected
  await notificationQueue.add('announcement-fanout', {
    channelId,
    messageId: message.id,
    title: input.title,
    body: input.body,
    excludeUserId: userId,
  });
  return message;
}

function listChannel(channelId: string) {
  return prisma.message.findMany({
    where: { channelId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: ANNOUNCEMENT_SELECT,
  });
}

export const announcementService = {
  // --- Global announcements (§4) ---
  async list() {
    return listChannel(await globalChannelId());
  },

  async post(userId: string, role: string, input: PostAnnouncementInput) {
    const channelId = await globalChannelId();
    if (role !== 'SUPER_ADMIN') {
      const m = await prisma.channelMembership.findUnique({
        where: { userId_channelId: { userId, channelId } },
        select: { role: true },
      });
      if (m?.role !== 'ADMIN' && m?.role !== 'MODERATOR') {
        throw Forbidden('Only super admins and announcement admins can post announcements');
      }
    }
    return broadcast(channelId, userId, input);
  },

  // --- Branch announcements (§3) — super admin or that branch's admin ---
  async listBranch(branchId: string) {
    return listChannel(await branchChannelId(branchId));
  },

  async postBranch(userId: string, role: string, branchId: string, input: PostAnnouncementInput) {
    if (role !== 'SUPER_ADMIN') {
      const bm = await prisma.branchMembership.findUnique({
        where: { userId_branchId: { userId, branchId } },
        select: { role: true },
      });
      if (bm?.role !== 'ADMIN') {
        throw Forbidden('Only super admins and branch admins can post branch announcements');
      }
    }
    return broadcast(await branchChannelId(branchId), userId, input);
  },

  // --- Announcement-admin management (Super Admin only, PRD §4) ---
  async listAdmins() {
    const channelId = await globalChannelId();
    const rows = await prisma.channelMembership.findMany({
      where: { channelId, role: { in: ['ADMIN', 'MODERATOR'] } },
      select: { role: true, user: { select: { id: true, displayName: true, email: true, avatarUrl: true } } },
    });
    return rows.map((r) => ({ ...r.user, role: r.role }));
  },

  async grantAdmin(userId: string) {
    const channelId = await globalChannelId();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw NotFound('User not found');
    await prisma.channelMembership.upsert({
      where: { userId_channelId: { userId, channelId } },
      create: { userId, channelId, role: 'ADMIN' },
      update: { role: 'ADMIN' },
    });
    return { ok: true };
  },

  async revokeAdmin(userId: string) {
    const channelId = await globalChannelId();
    await prisma.channelMembership.updateMany({ where: { userId, channelId }, data: { role: 'MEMBER' } });
    return { ok: true };
  },
};
