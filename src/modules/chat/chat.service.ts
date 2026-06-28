import { prisma } from '../../infra/db';
import { channelService } from '../channels/channels.service';
import { notificationService } from '../notifications/notifications.service';
import { emitToChannel } from '../../infra/realtime';
import { BadRequest, NotFound, Forbidden } from '../../utils/errors';
import type { SendMessageInput, ListMessagesInput } from './chat.schema';

const MESSAGE_SELECT = {
  id: true,
  channelId: true,
  senderId: true,
  type: true,
  body: true,
  mediaUrl: true,
  replyToId: true,
  pinnedById: true,
  pinnedAt: true,
  createdAt: true,
  editedAt: true,
  sender: { select: { id: true, displayName: true, avatarUrl: true } },
  reactions: { select: { emoji: true, userId: true } },
};

// Keyset cursor over (createdAt, id) — stable even when timestamps collide.
function encodeCursor(m: { createdAt: Date; id: string }) {
  return `${m.createdAt.toISOString()}_${m.id}`;
}
function decodeCursor(c: string): { createdAt: Date; id: string } | null {
  const i = c.lastIndexOf('_');
  if (i < 0) return null;
  const createdAt = new Date(c.slice(0, i));
  const id = c.slice(i + 1);
  if (Number.isNaN(createdAt.getTime()) || !id) return null;
  return { createdAt, id };
}

function isModerator(role: string, membershipRole: string | undefined) {
  return role === 'SUPER_ADMIN' || membershipRole === 'ADMIN' || membershipRole === 'MODERATOR';
}

export const chatService = {
  async send(userId: string, role: string, channelId: string, dto: SendMessageInput) {
    if (!dto.body && !dto.mediaUrl) throw BadRequest('A message needs a body or mediaUrl');
    const membership = await channelService.requireMember(userId, role, channelId);

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { isReadOnly: true, type: true },
    });
    if (!channel) throw NotFound('Channel not found');
    if (channel.isReadOnly && !isModerator(role, membership?.role)) {
      throw Forbidden('This channel is read-only');
    }

    if (dto.replyToId) {
      const parent = await prisma.message.findUnique({
        where: { id: dto.replyToId },
        select: { channelId: true },
      });
      if (!parent || parent.channelId !== channelId) throw BadRequest('Reply target is not in this channel');
    }

    const message = await prisma.message.create({
      data: {
        channelId,
        senderId: userId,
        type: dto.type,
        body: dto.body ?? null,
        mediaUrl: dto.mediaUrl ?? null,
        replyToId: dto.replyToId ?? null,
      },
      select: MESSAGE_SELECT,
    });
    emitToChannel(channelId, 'message:new', message);

    // DM = one recipient → safe to notify inline. Group/channel fan-out (many recipients) must go
    // through the BullMQ notification worker instead — never loop-notify a whole channel here.
    if (channel.type === 'DM') {
      const other = await prisma.channelMembership.findFirst({
        where: { channelId, userId: { not: userId } },
        select: { userId: true },
      });
      if (other) {
        await notificationService.notify(other.userId, {
          type: 'MESSAGE',
          title: message.sender.displayName ?? 'New message',
          body: message.body ?? 'Sent you a message',
          data: { channelId, messageId: message.id },
        });
      }
    }
    return message;
  },

  async list(userId: string, role: string, channelId: string, opts: ListMessagesInput) {
    await channelService.requireMember(userId, role, channelId);
    const c = opts.cursor ? decodeCursor(opts.cursor) : null;
    const rows = await prisma.message.findMany({
      where: {
        channelId,
        deletedAt: null,
        ...(c
          ? { OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: opts.limit + 1,
      select: MESSAGE_SELECT,
    });
    const hasMore = rows.length > opts.limit;
    const messages = rows.slice(0, opts.limit);
    const last = messages[messages.length - 1];
    return { messages, nextCursor: hasMore && last ? encodeCursor(last) : null };
  },

  async addReaction(userId: string, role: string, messageId: string, emoji: string) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt) throw NotFound('Message not found');
    await channelService.requireMember(userId, role, msg.channelId);
    await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId, userId, emoji } },
      create: { messageId, userId, emoji },
      update: {},
    });
    emitToChannel(msg.channelId, 'reaction:add', { messageId, userId, emoji });
    return { ok: true };
  },

  async removeReaction(userId: string, role: string, messageId: string, emoji: string) {
    const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
    if (!msg) throw NotFound('Message not found');
    await channelService.requireMember(userId, role, msg.channelId);
    await prisma.reaction.deleteMany({ where: { messageId, userId, emoji } });
    emitToChannel(msg.channelId, 'reaction:remove', { messageId, userId, emoji });
    return { ok: true };
  },

  async setPin(userId: string, role: string, messageId: string, pinned: boolean) {
    const msg = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
    if (!msg) throw NotFound('Message not found');
    const membership = await channelService.requireMember(userId, role, msg.channelId);
    if (!isModerator(role, membership?.role)) throw Forbidden('Only moderators can pin messages');
    const message = await prisma.message.update({
      where: { id: messageId },
      data: pinned ? { pinnedById: userId, pinnedAt: new Date() } : { pinnedById: null, pinnedAt: null },
      select: MESSAGE_SELECT,
    });
    emitToChannel(msg.channelId, pinned ? 'message:pinned' : 'message:unpinned', { messageId });
    return message;
  },

  async remove(userId: string, role: string, messageId: string) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, senderId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt) throw NotFound('Message not found');
    const membership = await channelService.requireMember(userId, role, msg.channelId);
    const canDelete = msg.senderId === userId || isModerator(role, membership?.role);
    if (!canDelete) throw Forbidden('You can only delete your own messages');
    await prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), body: null, mediaUrl: null }, // soft delete + scrub content
    });
    emitToChannel(msg.channelId, 'message:deleted', { messageId });
    return { ok: true };
  },
};
