import { prisma } from '../../infra/db';
import { NotFound, BadRequest, Forbidden } from '../../utils/errors';

const CHANNEL_SELECT = {
  id: true,
  type: true,
  name: true,
  isReadOnly: true,
  branchId: true,
  clusterId: true,
} as const;

export const channelService = {
  // Membership gate reused across chat ops. SUPER_ADMIN bypasses (can read/moderate any channel).
  async requireMember(userId: string, role: string, channelId: string) {
    const membership = await prisma.channelMembership.findUnique({
      where: { userId_channelId: { userId, channelId } },
    });
    if (!membership && role !== 'SUPER_ADMIN') throw Forbidden('You are not a member of this channel');
    return membership;
  },

  // The Chats list: every channel the user belongs to, with last message + unread count.
  async listMine(userId: string) {
    const memberships = await prisma.channelMembership.findMany({
      where: { userId },
      select: {
        role: true,
        lastReadAt: true,
        channel: {
          select: {
            ...CHANNEL_SELECT,
            branch: { select: { name: true } },
            cluster: { select: { name: true } },
          },
        },
      },
    });

    const items = await Promise.all(
      memberships.map(async (m) => {
        const ch = m.channel;
        const [lastMessage, unreadCount, dmPeer] = await Promise.all([
          prisma.message.findFirst({
            where: { channelId: ch.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true, body: true, type: true, senderId: true, createdAt: true },
          }),
          prisma.message.count({
            where: {
              channelId: ch.id,
              deletedAt: null,
              senderId: { not: userId },
              ...(m.lastReadAt ? { createdAt: { gt: m.lastReadAt } } : {}),
            },
          }),
          ch.type === 'DM'
            ? prisma.channelMembership.findFirst({
                where: { channelId: ch.id, userId: { not: userId } },
                select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
              })
            : Promise.resolve(null),
        ]);
        return {
          id: ch.id,
          type: ch.type,
          name: ch.name ?? ch.branch?.name ?? ch.cluster?.name ?? dmPeer?.user.displayName ?? null,
          isReadOnly: ch.isReadOnly,
          role: m.role,
          lastReadAt: m.lastReadAt,
          unreadCount,
          lastMessage,
          peer: dmPeer?.user ?? null,
        };
      }),
    );

    items.sort(
      (a, b) => (b.lastMessage?.createdAt?.getTime() ?? 0) - (a.lastMessage?.createdAt?.getTime() ?? 0),
    );
    return items;
  },

  async get(userId: string, role: string, channelId: string) {
    await this.requireMember(userId, role, channelId);
    const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: CHANNEL_SELECT });
    if (!channel) throw NotFound('Channel not found');
    return channel;
  },

  async markRead(userId: string, role: string, channelId: string) {
    await this.requireMember(userId, role, channelId);
    await prisma.channelMembership.updateMany({
      where: { userId, channelId },
      data: { lastReadAt: new Date() },
    });
    return { ok: true };
  },

  // Open (or return existing) a 1:1 DM channel.
  async openDm(userId: string, otherUserId: string) {
    if (userId === otherUserId) throw BadRequest('Cannot start a DM with yourself');
    const other = await prisma.user.findUnique({ where: { id: otherUserId }, select: { id: true } });
    if (!other) throw NotFound('User not found');

    const existing = await prisma.channel.findFirst({
      where: {
        type: 'DM',
        AND: [{ memberships: { some: { userId } } }, { memberships: { some: { userId: otherUserId } } }],
      },
      select: CHANNEL_SELECT,
    });
    if (existing) return existing;

    return prisma.channel.create({
      data: { type: 'DM', memberships: { create: [{ userId }, { userId: otherUserId }] } },
      select: CHANNEL_SELECT,
    });
  },
};
