import { Prisma } from '@prisma/client';
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

  // The Chats list. Batched (not N+1): one grouped unread query honouring each channel's lastReadAt,
  // one DISTINCT ON for the last message, one for DM peers — ~4 queries regardless of channel count.
  async listMine(userId: string) {
    const memberships = await prisma.channelMembership.findMany({
      where: { userId },
      select: {
        role: true,
        lastReadAt: true,
        channel: {
          select: { ...CHANNEL_SELECT, branch: { select: { name: true } }, cluster: { select: { name: true } } },
        },
      },
    });
    if (memberships.length === 0) return [];
    const channelIds = memberships.map((m) => m.channel.id);

    const unreadRows = await prisma.$queryRaw<{ channelId: string; count: number }[]>`
      SELECT cm."channelId", COUNT(m."id")::int AS count
      FROM "ChannelMembership" cm
      JOIN "Message" m
        ON m."channelId" = cm."channelId"
       AND m."deletedAt" IS NULL
       AND m."senderId" <> cm."userId"
       AND (cm."lastReadAt" IS NULL OR m."createdAt" > cm."lastReadAt")
      WHERE cm."userId" = ${userId}
      GROUP BY cm."channelId"`;
    const unreadMap = new Map(unreadRows.map((r) => [r.channelId, r.count]));

    const lastRows = await prisma.$queryRaw<
      { id: string; channelId: string; body: string | null; type: string; senderId: string; createdAt: Date }[]
    >`
      SELECT DISTINCT ON (m."channelId") m."id", m."channelId", m."body", m."type", m."senderId", m."createdAt"
      FROM "Message" m
      WHERE m."channelId" IN (${Prisma.join(channelIds)}) AND m."deletedAt" IS NULL
      ORDER BY m."channelId", m."createdAt" DESC, m."id" DESC`;
    const lastMap = new Map(lastRows.map((r) => [r.channelId, r]));

    const dmIds = memberships.filter((m) => m.channel.type === 'DM').map((m) => m.channel.id);
    const peers = dmIds.length
      ? await prisma.channelMembership.findMany({
          where: { channelId: { in: dmIds }, userId: { not: userId } },
          select: { channelId: true, user: { select: { id: true, displayName: true, avatarUrl: true } } },
        })
      : [];
    const peerMap = new Map(peers.map((p) => [p.channelId, p.user]));

    const items = memberships.map((m) => {
      const ch = m.channel;
      const peer = peerMap.get(ch.id) ?? null;
      return {
        id: ch.id,
        type: ch.type,
        name: ch.name ?? ch.branch?.name ?? ch.cluster?.name ?? peer?.displayName ?? null,
        isReadOnly: ch.isReadOnly,
        role: m.role,
        lastReadAt: m.lastReadAt,
        unreadCount: unreadMap.get(ch.id) ?? 0,
        lastMessage: lastMap.get(ch.id) ?? null,
        peer,
      };
    });
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
