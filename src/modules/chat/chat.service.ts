import { prisma } from '../../infra/db';
import { channelService } from '../channels/channels.service';
import { notificationQueue } from '../../infra/queue';
import { emitToChannel } from '../../infra/realtime';
import { logger } from '../../infra/logger';
import { BadRequest, NotFound, Forbidden } from '../../utils/errors';
import { optimizeImage, thumbUrl } from '../../utils/cloudinaryUrl';
import type { SendMessageInput, ListMessagesInput } from './chat.schema';

const POLL_SELECT = {
  id: true,
  question: true,
  allowMultiple: true,
  expiresAt: true,
  options: {
    orderBy: { order: 'asc' as const },
    select: {
      id: true,
      text: true,
      order: true,
      votes: { select: { userId: true } },
    },
  },
};

const MESSAGE_SELECT = {
  id: true,
  channelId: true,
  senderId: true,
  type: true,
  title: true,
  body: true,
  mediaUrl: true,
  replyToId: true,
  forwardedFromId: true,
  pinnedById: true,
  pinnedAt: true,
  createdAt: true,
  editedAt: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  poll: { select: POLL_SELECT },
  sender: { select: { id: true, displayName: true, avatarUrl: true } },
  reactions: { select: { emoji: true, userId: true } },
  // Reply preview — enough for the client to render "↳ Kwasu: Praying for peace" without a
  // second fetch. deletedAt lets the UI show "message deleted" for a reply whose parent is gone.
  replyTo: {
    select: {
      id: true,
      type: true,
      body: true,
      mediaUrl: true,
      senderId: true,
      deletedAt: true,
      sender: { select: { id: true, displayName: true } },
    },
  },
};

// Attach a small preview URL (image thumb / video poster) so lists render fast on slow networks.
// Applied to every message that leaves the server — REST and socket payloads stay identical.
function withThumb<T extends { mediaUrl: string | null; type: string }>(m: T): T & { thumbUrl: string | null } {
  return { ...m, thumbUrl: thumbUrl(m.mediaUrl, m.type) };
}

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
    if (dto.type === 'CONTACT') {
      if (!dto.contactName) throw BadRequest('contactName is required for CONTACT messages');
      if (!dto.contactPhone && !dto.contactEmail) throw BadRequest('contactPhone or contactEmail is required');
    } else if (dto.type === 'POLL') {
      if (!dto.poll) throw BadRequest('poll object is required for POLL messages');
    } else if (!dto.body && !dto.mediaUrl) {
      throw BadRequest('A message needs a body or mediaUrl');
    }
    const [membership, channel] = await Promise.all([
      channelService.requireMember(userId, role, channelId),
      prisma.channel.findUnique({
        where: { id: channelId },
        select: { isReadOnly: true, type: true },
      }),
    ]);
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

    // For POLL messages, create via the relation API so Prisma is happy with types.
    if (dto.type === 'POLL' && dto.poll) {
      const poll = await prisma.poll.create({
        data: {
          question: dto.poll.question,
          allowMultiple: dto.poll.allowMultiple,
          expiresAt: dto.poll.expiresAt ?? null,
          options: { create: dto.poll.options.map((text, i) => ({ text, order: i })) },
        },
      });
      const message = await prisma.message.create({
        data: {
          channelId,
          senderId: userId,
          type: 'POLL',
          body: dto.poll.question,
          replyToId: dto.replyToId ?? null,
          pollId: poll.id,
        },
        select: MESSAGE_SELECT,
      });
      const decorated = withThumb(message);
      emitToChannel(channelId, 'message:new', decorated);
      return decorated;
    }

    // Store images as right-sized auto-format delivery URLs (originals stay in Cloudinary) so
    // every future read — on any client — downloads a fraction of the bytes.
    const message = await prisma.message.create({
      data: {
        channelId,
        senderId: userId,
        type: dto.type,
        body: dto.body ?? null,
        mediaUrl: dto.mediaUrl ? (dto.type === 'IMAGE' ? optimizeImage(dto.mediaUrl) : dto.mediaUrl) : null,
        replyToId: dto.replyToId ?? null,
        contactName: dto.contactName ?? null,
        contactPhone: dto.contactPhone ?? null,
        contactEmail: dto.contactEmail ?? null,
      },
      select: MESSAGE_SELECT,
    });
    emitToChannel(channelId, 'message:new', withThumb(message));

    // Fire-and-forget: the sender's response must not block on Redis enqueue. If the enqueue
    // fails, the socket delivery already happened; log and move on. This shaves 10-20ms off
    // the send round trip AND lets the socket emit reach the recipient sooner because we're
    // not holding a Redis connection ahead of it.
    const senderName = message.sender.displayName ?? 'Someone';
    const jobBase = { channelId, messageId: message.id, senderId: userId, body: message.body };
    if (channel.type === 'DM') {
      notificationQueue.add('dm-notify', { ...jobBase, senderName: message.sender.displayName ?? 'New message' })
        .catch((err) => logger.warn({ err, channelId, messageId: message.id }, 'dm-notify enqueue failed'));
    } else {
      notificationQueue.add('message-fanout', { ...jobBase, senderName })
        .catch((err) => logger.warn({ err, channelId, messageId: message.id }, 'message-fanout enqueue failed'));
    }

    // @mentions — notify the tagged users who are members of this channel (PRD §7).
    // @everyone (mentionEveryone: true) fans out to every non-muted member; the worker resolves
    // the recipient list against ChannelMembership at fan-out time so it stays fresh.
    if (dto.mentionEveryone) {
      notificationQueue.add('mention-fanout', {
        channelId, messageId: message.id, senderName, body: message.body,
        everyone: true, excludeUserId: userId,
      }).catch((err) => logger.warn({ err, channelId, messageId: message.id }, 'mention-fanout enqueue failed'));
    } else if (dto.mentions?.length) {
      const targets = [...new Set(dto.mentions)].filter((id) => id !== userId);
      if (targets.length) {
        notificationQueue.add('mention-fanout', {
          channelId, messageId: message.id, senderName, body: message.body, targets,
        }).catch((err) => logger.warn({ err, channelId, messageId: message.id }, 'mention-fanout enqueue failed'));
      }
    }
    return withThumb(message);
  },

  async list(userId: string, role: string, channelId: string, opts: ListMessagesInput) {
    await channelService.requireMember(userId, role, channelId);
    const c = opts.cursor ? decodeCursor(opts.cursor) : null;
    const [rows, channel] = await Promise.all([
      prisma.message.findMany({
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
      }),
      prisma.channel.findUnique({ where: { id: channelId }, select: { type: true } }),
    ]);
    const hasMore = rows.length > opts.limit;
    const messages = rows.slice(0, opts.limit);
    const last = messages[messages.length - 1];

    // Read receipts (DM ticks): the peer's lastReadAt tells the client which of my messages they've
    // read. For groups this is null (read state there is per-member, surfaced as unread counts).
    let peerLastReadAt: Date | null = null;
    if (channel?.type === 'DM') {
      const peer = await prisma.channelMembership.findFirst({
        where: { channelId, userId: { not: userId } },
        select: { lastReadAt: true },
      });
      peerLastReadAt = peer?.lastReadAt ?? null;
    }
    return { messages: messages.map(withThumb), nextCursor: hasMore && last ? encodeCursor(last) : null, peerLastReadAt };
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
    return withThumb(message);
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

  // Edit your own message (PRD §7). Sets editedAt and broadcasts message:edited.
  async edit(userId: string, messageId: string, body: string) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, senderId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt) throw NotFound('Message not found');
    if (msg.senderId !== userId) throw Forbidden('You can only edit your own messages');
    const message = await prisma.message.update({
      where: { id: messageId },
      data: { body, editedAt: new Date() },
      select: MESSAGE_SELECT,
    });
    const decorated = withThumb(message);
    emitToChannel(msg.channelId, 'message:edited', decorated);
    return decorated;
  },

  // Forward a message into another channel you can post to (PRD §7). Copies the content and links
  // back via forwardedFromId so the client can render a "Forwarded" label.
  async forward(userId: string, role: string, messageId: string, targetChannelId: string) {
    const src = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, type: true, body: true, mediaUrl: true, deletedAt: true },
    });
    if (!src || src.deletedAt) throw NotFound('Message not found');
    await channelService.requireMember(userId, role, src.channelId); // can read the source
    const membership = await channelService.requireMember(userId, role, targetChannelId); // can post to target
    const target = await prisma.channel.findUnique({ where: { id: targetChannelId }, select: { isReadOnly: true } });
    if (!target) throw NotFound('Target channel not found');
    if (target.isReadOnly && !isModerator(role, membership?.role)) throw Forbidden('Target channel is read-only');

    const message = await prisma.message.create({
      data: {
        channelId: targetChannelId,
        senderId: userId,
        type: src.type,
        body: src.body,
        mediaUrl: src.mediaUrl,
        forwardedFromId: messageId,
      },
      select: MESSAGE_SELECT,
    });
    const decorated = withThumb(message);
    emitToChannel(targetChannelId, 'message:new', decorated);
    return decorated;
  },

  // Search a channel's messages (PRD §7). Case-insensitive substring on the body.
  async search(userId: string, role: string, channelId: string, q: string) {
    await channelService.requireMember(userId, role, channelId);
    const rows = await prisma.message.findMany({
      where: { channelId, deletedAt: null, body: { contains: q, mode: 'insensitive' } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: MESSAGE_SELECT,
    });
    return rows.map(withThumb);
  },

  // Vote on a poll option. Respects allowMultiple — if false, moves the vote to the new option.
  async votePoll(userId: string, role: string, messageId: string, optionId: string) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, type: true, pollId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt || msg.type !== 'POLL' || !msg.pollId) throw NotFound('Poll not found');
    await channelService.requireMember(userId, role, msg.channelId);

    const option = await prisma.pollOption.findUnique({ where: { id: optionId }, select: { pollId: true } });
    if (!option || option.pollId !== msg.pollId) throw BadRequest('Option does not belong to this poll');

    const poll = await prisma.poll.findUnique({ where: { id: msg.pollId }, select: { allowMultiple: true, expiresAt: true } });
    if (poll?.expiresAt && poll.expiresAt < new Date()) throw BadRequest('This poll has expired');

    if (!poll?.allowMultiple) {
      await prisma.pollVote.deleteMany({ where: { option: { pollId: msg.pollId }, userId } });
    }

    await prisma.pollVote.upsert({
      where: { optionId_userId: { optionId, userId } },
      create: { optionId, userId },
      update: {},
    });

    const updated = await prisma.poll.findUnique({ where: { id: msg.pollId }, select: POLL_SELECT });
    emitToChannel(msg.channelId, 'poll:voted', { messageId, poll: updated });
    return updated;
  },

  // Retract a vote from a poll option.
  async retractVote(userId: string, role: string, messageId: string, optionId: string) {
    const msg = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true, type: true, pollId: true, deletedAt: true },
    });
    if (!msg || msg.deletedAt || msg.type !== 'POLL' || !msg.pollId) throw NotFound('Poll not found');
    await channelService.requireMember(userId, role, msg.channelId);

    await prisma.pollVote.deleteMany({ where: { optionId, userId } });

    const updated = await prisma.poll.findUnique({ where: { id: msg.pollId }, select: POLL_SELECT });
    emitToChannel(msg.channelId, 'poll:voted', { messageId, poll: updated });
    return updated;
  },
};
