import { prisma } from '../../infra/db';
import { notificationQueue } from '../../infra/queue';
import { emitToChannel } from '../../infra/realtime';
import { Forbidden, NotFound } from '../../utils/errors';
import type { PostAnnouncementInput } from './announcements.schema';

// PRD §4: the Global Announcement channel. Official leadership comms — read-only for members,
// posted by Super Admins + authorized "Announcement Admins" (= ADMIN/MODERATOR on this channel).
const ANNOUNCEMENT_SELECT = {
  id: true,
  title: true,
  body: true,
  createdAt: true,
  sender: { select: { id: true, displayName: true, avatarUrl: true } },
} as const;

async function globalChannelId(): Promise<string> {
  const ch = await prisma.channel.findFirst({ where: { type: 'GLOBAL_ANNOUNCEMENT' }, select: { id: true } });
  if (!ch) throw NotFound('Global announcement channel not found');
  return ch.id;
}

export const announcementService = {
  // Read feed (Home → Announcements, §14). Org-wide readable for any authenticated user.
  async list() {
    const channelId = await globalChannelId();
    return prisma.message.findMany({
      where: { channelId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: ANNOUNCEMENT_SELECT,
    });
  },

  // Post an announcement. Super admin, or an authorized announcement admin (ADMIN/MODERATOR here).
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

    const message = await prisma.message.create({
      data: { channelId, senderId: userId, type: 'TEXT', title: input.title, body: input.body },
      select: ANNOUNCEMENT_SELECT,
    });
    emitToChannel(channelId, 'message:new', message); // live for members currently connected

    // Fan-out to every member's notification centre off the request path (§12). The BullMQ worker
    // batches the inserts (this is the 10k-recipient fan-out chat.service deliberately defers here).
    // FCM push delivery hooks into the same job later.
    await notificationQueue.add('announcement-fanout', {
      channelId,
      messageId: message.id,
      title: input.title,
      body: input.body,
      excludeUserId: userId,
    });
    return message;
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
    // Demote to MEMBER — they keep reading the channel, they just can't post any more.
    await prisma.channelMembership.updateMany({ where: { userId, channelId }, data: { role: 'MEMBER' } });
    return { ok: true };
  },
};
