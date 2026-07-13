import { prisma } from '../../infra/db';
import { buildRtcToken, isAgoraConfigured } from '../../infra/agora';
import { emitToUser } from '../../infra/realtime';
import { notificationQueue } from '../../infra/queue';
import { pushService } from '../push/push.service';
import { BadRequest, Forbidden, NotFound } from '../../utils/errors';
import { env } from '../../config/env';
import type { CreateRoomInput, UpdateRoomInput } from './audio-rooms.schema';

const ROOM_SELECT = {
  id: true,
  title: true,
  description: true,
  branchId: true,
  clusterId: true,
  hostId: true,
  status: true,
  scheduledFor: true,
  startedAt: true,
  endedAt: true,
  createdAt: true,
} as const;

const PARTICIPANT_SELECT = {
  id: true,
  userId: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, displayName: true, avatarUrl: true } },
} as const;

function stableUid(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_000_000_000;
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'BRANCH_ADMIN'];

export const audioRoomService = {
  async create(userId: string, role: string, dto: CreateRoomInput) {
    if (!ADMIN_ROLES.includes(role)) throw Forbidden('Only admins can create audio rooms');

    const room = await prisma.audioRoom.create({
      data: {
        title: dto.title,
        description: dto.description ?? null,
        branchId: dto.branchId ?? null,
        clusterId: dto.clusterId ?? null,
        hostId: userId,
        provider: 'agora',
        status: dto.scheduledFor ? 'SCHEDULED' : 'LIVE',
        scheduledFor: dto.scheduledFor ?? null,
        startedAt: dto.scheduledFor ? null : new Date(),
        participants: {
          create: { userId, role: 'HOST' },
        },
      },
      select: { ...ROOM_SELECT, participants: { select: PARTICIPANT_SELECT } },
    });

    if (room.status === 'LIVE') {
      await this.notifyRoomStarted(room.id, room.title, room.branchId, room.clusterId, userId);
    }
    // Host publishes audio from the moment the room is live — hand them the token in the same response.
    return { ...room, agora: room.status === 'LIVE' ? this.issueToken(room.id, userId, 'host') : null };
  },

  async update(userId: string, role: string, roomId: string, dto: UpdateRoomInput) {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { hostId: true, status: true } });
    if (!room) throw NotFound('Room not found');
    if (room.hostId !== userId && role !== 'SUPER_ADMIN') throw Forbidden('Only the host can update this room');
    if (room.status === 'ENDED') throw BadRequest('Cannot update an ended room');

    return prisma.audioRoom.update({
      where: { id: roomId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.scheduledFor !== undefined ? { scheduledFor: dto.scheduledFor } : {}),
      },
      select: ROOM_SELECT,
    });
  },

  // Room cards for the Audio tab. Each card carries what the UI shows: host (name+avatar),
  // speaker count, listener count, a short avatar preview strip, and the caller's Remind-Me state.
  async list(userId: string, filter: 'live' | 'scheduled' | 'ended' = 'live', branchId?: string, clusterId?: string) {
    const where: Record<string, unknown> = {};
    if (filter === 'live') where.status = 'LIVE';
    else if (filter === 'scheduled') where.status = 'SCHEDULED';
    else where.status = 'ENDED';
    if (branchId) where.branchId = branchId;
    if (clusterId) where.clusterId = clusterId;

    const rooms = await prisma.audioRoom.findMany({
      where,
      orderBy: filter === 'scheduled' ? { scheduledFor: 'asc' } : { startedAt: 'desc' },
      take: 50,
      select: {
        ...ROOM_SELECT,
        // AudioRole enum order is HOST, SPEAKER, LISTENER — so host + speakers sort first.
        participants: {
          where: { leftAt: null },
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          take: 8,
          select: { role: true, user: { select: { id: true, displayName: true, avatarUrl: true } } },
        },
        reminders: { where: { userId }, select: { id: true } },
      },
    });
    if (!rooms.length) return [];

    // Exact per-role counts in one grouped query (the capped participant strip can't count 234 listeners).
    const counts = await prisma.audioRoomParticipant.groupBy({
      by: ['roomId', 'role'],
      where: { roomId: { in: rooms.map((r) => r.id) }, leftAt: null },
      _count: true,
    });
    const countMap = new Map<string, { speakers: number; listeners: number }>();
    for (const c of counts) {
      const entry = countMap.get(c.roomId) ?? { speakers: 0, listeners: 0 };
      if (c.role === 'LISTENER') entry.listeners += c._count;
      else entry.speakers += c._count; // HOST + SPEAKER both hold the mic
      countMap.set(c.roomId, entry);
    }

    return rooms.map((r) => {
      const { participants, reminders, ...room } = r;
      const host = participants.find((p) => p.role === 'HOST')?.user ?? null;
      const c = countMap.get(r.id) ?? { speakers: 0, listeners: 0 };
      return {
        ...room,
        host,
        speakerCount: c.speakers,
        listenerCount: c.listeners,
        participantsPreview: participants.map((p) => p.user),
        isReminding: reminders.length > 0,
      };
    });
  },

  // Room detail. All speakers (few), listeners capped at 30 + exact listenerCount for the "+229" chip.
  async get(userId: string, roomId: string) {
    const room = await prisma.audioRoom.findUnique({
      where: { id: roomId },
      select: {
        ...ROOM_SELECT,
        participants: {
          where: { leftAt: null, role: { in: ['HOST', 'SPEAKER'] } },
          select: PARTICIPANT_SELECT,
          orderBy: { joinedAt: 'asc' },
        },
        reminders: { where: { userId }, select: { id: true } },
      },
    });
    if (!room) throw NotFound('Room not found');

    const [listeners, listenerCount] = await Promise.all([
      prisma.audioRoomParticipant.findMany({
        where: { roomId, leftAt: null, role: 'LISTENER' },
        select: PARTICIPANT_SELECT,
        orderBy: { joinedAt: 'asc' },
        take: 30,
      }),
      prisma.audioRoomParticipant.count({ where: { roomId, leftAt: null, role: 'LISTENER' } }),
    ]);

    const { participants, reminders, ...rest } = room;
    return {
      ...rest,
      speakers: participants,
      listeners,
      listenerCount,
      isReminding: reminders.length > 0,
    };
  },

  // "Remind Me" on a scheduled room — notified when the host actually starts it.
  async remind(userId: string, roomId: string) {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { status: true } });
    if (!room) throw NotFound('Room not found');
    if (room.status !== 'SCHEDULED') throw BadRequest('Reminders are only for scheduled rooms');
    await prisma.audioRoomReminder.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    });
    return { ok: true, isReminding: true };
  },

  async unremind(userId: string, roomId: string) {
    await prisma.audioRoomReminder.deleteMany({ where: { roomId, userId } });
    return { ok: true, isReminding: false };
  },

  async start(userId: string, role: string, roomId: string) {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { hostId: true, status: true, title: true, branchId: true, clusterId: true } });
    if (!room) throw NotFound('Room not found');
    if (room.hostId !== userId && role !== 'SUPER_ADMIN') throw Forbidden('Only the host can start this room');
    if (room.status !== 'SCHEDULED') throw BadRequest('Room is not in SCHEDULED state');

    const updated = await prisma.audioRoom.update({
      where: { id: roomId },
      data: { status: 'LIVE', startedAt: new Date() },
      select: { ...ROOM_SELECT, participants: { where: { leftAt: null }, select: PARTICIPANT_SELECT } },
    });

    await this.notifyRoomStarted(roomId, room.title, room.branchId, room.clusterId, userId);
    return { ...updated, agora: this.issueToken(roomId, userId, 'host') };
  },

  async end(userId: string, role: string, roomId: string) {
    const room = await prisma.audioRoom.findUnique({
      where: { id: roomId },
      select: { hostId: true, status: true, participants: { where: { leftAt: null }, select: { userId: true } } },
    });
    if (!room) throw NotFound('Room not found');
    if (room.hostId !== userId && role !== 'SUPER_ADMIN') throw Forbidden('Only the host can end this room');
    if (room.status === 'ENDED') throw BadRequest('Room already ended');

    const updated = await prisma.audioRoom.update({
      where: { id: roomId },
      data: { status: 'ENDED', endedAt: new Date() },
      select: ROOM_SELECT,
    });
    await prisma.audioRoomParticipant.updateMany({
      where: { roomId, leftAt: null },
      data: { leftAt: new Date() },
    });

    for (const p of room.participants) {
      emitToUser(p.userId, 'audio-room:ended', { roomId });
    }
    return updated;
  },

  async join(userId: string, roomId: string) {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { id: true, status: true } });
    if (!room) throw NotFound('Room not found');
    if (room.status !== 'LIVE') throw BadRequest('Room is not live');

    const existing = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId, leftAt: null },
    });
    if (existing) throw BadRequest('Already in this room');

    const participant = await prisma.audioRoomParticipant.create({
      data: { roomId, userId, role: 'LISTENER' },
      select: PARTICIPANT_SELECT,
    });

    this.emitToRoom(roomId, 'audio-room:user-joined', participant);

    const token = this.issueToken(roomId, userId, 'audience');
    return { participant, agora: token };
  },

  async leave(userId: string, roomId: string) {
    const p = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId, leftAt: null },
      select: { id: true, role: true },
    });
    if (!p) throw BadRequest('Not in this room');

    await prisma.audioRoomParticipant.update({
      where: { id: p.id },
      data: { leftAt: new Date() },
    });

    this.emitToRoom(roomId, 'audio-room:user-left', { roomId, userId });

    if (p.role === 'HOST') {
      const nextSpeaker = await prisma.audioRoomParticipant.findFirst({
        where: { roomId, leftAt: null, role: 'SPEAKER' },
        orderBy: { joinedAt: 'asc' },
      });
      if (nextSpeaker) {
        await prisma.audioRoomParticipant.update({
          where: { id: nextSpeaker.id },
          data: { role: 'HOST' },
        });
        await prisma.audioRoom.update({ where: { id: roomId }, data: { hostId: nextSpeaker.userId } });
        this.emitToRoom(roomId, 'audio-room:role-changed', {
          roomId, userId: nextSpeaker.userId, role: 'HOST',
        });
      } else {
        await prisma.audioRoom.update({
          where: { id: roomId },
          data: { status: 'ENDED', endedAt: new Date() },
        });
        await prisma.audioRoomParticipant.updateMany({
          where: { roomId, leftAt: null },
          data: { leftAt: new Date() },
        });
        this.emitToRoom(roomId, 'audio-room:ended', { roomId });
      }
    }
    return { ok: true };
  },

  async raiseHand(userId: string, roomId: string) {
    const p = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId, leftAt: null },
      select: { id: true, role: true },
    });
    if (!p) throw BadRequest('Not in this room');
    if (p.role !== 'LISTENER') throw BadRequest('Only listeners can raise hand');

    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { hostId: true } });
    if (room) {
      emitToUser(room.hostId, 'audio-room:hand-raised', { roomId, userId });
    }
    this.emitToRoom(roomId, 'audio-room:hand-raised', { roomId, userId });
    return { ok: true };
  },

  async promote(hostUserId: string, role: string, roomId: string, targetUserId: string, targetRole: 'SPEAKER' | 'LISTENER') {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { hostId: true, status: true } });
    if (!room) throw NotFound('Room not found');
    if (room.status !== 'LIVE') throw BadRequest('Room is not live');
    if (room.hostId !== hostUserId && role !== 'SUPER_ADMIN') throw Forbidden('Only the host can change roles');

    const p = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId: targetUserId, leftAt: null },
      select: { id: true },
    });
    if (!p) throw BadRequest('User is not in this room');

    await prisma.audioRoomParticipant.update({
      where: { id: p.id },
      data: { role: targetRole },
    });

    this.emitToRoom(roomId, 'audio-room:role-changed', {
      roomId, userId: targetUserId, role: targetRole,
    });

    if (targetRole === 'SPEAKER') {
      const token = this.issueToken(roomId, targetUserId, 'host');
      emitToUser(targetUserId, 'audio-room:token', { roomId, ...token });
    }

    return { ok: true };
  },

  async kick(hostUserId: string, role: string, roomId: string, targetUserId: string) {
    const room = await prisma.audioRoom.findUnique({ where: { id: roomId }, select: { hostId: true } });
    if (!room) throw NotFound('Room not found');
    if (room.hostId !== hostUserId && role !== 'SUPER_ADMIN') throw Forbidden('Only the host can remove users');

    const p = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId: targetUserId, leftAt: null },
      select: { id: true },
    });
    if (!p) throw BadRequest('User is not in this room');

    await prisma.audioRoomParticipant.update({ where: { id: p.id }, data: { leftAt: new Date() } });
    emitToUser(targetUserId, 'audio-room:kicked', { roomId });
    this.emitToRoom(roomId, 'audio-room:user-left', { roomId, userId: targetUserId });
    return { ok: true };
  },

  async refreshToken(userId: string, roomId: string) {
    const p = await prisma.audioRoomParticipant.findFirst({
      where: { roomId, userId, leftAt: null },
      select: { role: true },
    });
    if (!p) throw BadRequest('Not in this room');

    const agoraRole = p.role === 'LISTENER' ? 'audience' : 'host';
    return this.issueToken(roomId, userId, agoraRole as 'host' | 'audience');
  },

  issueToken(roomId: string, userId: string, agoraRole: 'host' | 'audience') {
    if (!isAgoraConfigured()) {
      return { appId: null, token: null, channel: roomId, uid: stableUid(userId) };
    }
    const uid = stableUid(userId);
    const token = buildRtcToken(roomId, uid, agoraRole);
    return { appId: env.AGORA_APP_ID!, token, channel: roomId, uid };
  },

  async emitToRoom(roomId: string, event: string, data: unknown) {
    const participants = await prisma.audioRoomParticipant.findMany({
      where: { roomId, leftAt: null },
      select: { userId: true },
    });
    for (const p of participants) {
      emitToUser(p.userId, event, data);
    }
  },

  async notifyRoomStarted(roomId: string, title: string, branchId: string | null, clusterId: string | null, hostId: string) {
    const userIds = new Set<string>();

    // Everyone who tapped "Remind Me" gets notified, regardless of channel membership.
    const reminders = await prisma.audioRoomReminder.findMany({ where: { roomId }, select: { userId: true } });
    for (const r of reminders) userIds.add(r.userId);

    if (branchId || clusterId) {
      const channelWhere: Record<string, unknown> = {};
      if (branchId) channelWhere.branchId = branchId;
      if (clusterId) channelWhere.clusterId = clusterId;
      const channel = await prisma.channel.findFirst({ where: channelWhere, select: { id: true } });
      if (channel) {
        const members = await prisma.channelMembership.findMany({
          where: { channelId: channel.id, mutedAt: null },
          select: { userId: true },
        });
        for (const m of members) userIds.add(m.userId);
      }
    }

    userIds.delete(hostId);
    if (userIds.size) {
      await notificationQueue.add('audio-room-started', { roomId, title, userIds: [...userIds] });
    }
    // Reminders are one-shot — clear them once fired.
    if (reminders.length) await prisma.audioRoomReminder.deleteMany({ where: { roomId } });
  },

  // Repeatable scan (notification worker, every 5 min): "starting soon" push for scheduled rooms.
  // Notifies Remind-Me users + nudges the host to go live. Same reminderSentAt pattern as events.
  // Reminder rows are kept — they fire again as "room is live" when the host actually starts it.
  async sendDueRoomReminders(windowMs = 15 * 60 * 1000) {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowMs);
    const rooms = await prisma.audioRoom.findMany({
      where: { status: 'SCHEDULED', reminderSentAt: null, scheduledFor: { gt: now, lte: windowEnd } },
      select: {
        id: true,
        title: true,
        scheduledFor: true,
        hostId: true,
        reminders: { select: { userId: true } },
      },
    });

    let notified = 0;
    for (const room of rooms) {
      const startsAt = room.scheduledFor!.toISOString();

      // Attendees who tapped Remind Me
      const attendeeIds = room.reminders.map((r) => r.userId).filter((id) => id !== room.hostId);
      if (attendeeIds.length) {
        const payload = {
          title: `Starting soon: ${room.title}`,
          body: 'The room goes live in a few minutes — tap to be ready.',
          data: { roomId: room.id, startsAt },
        };
        for (let i = 0; i < attendeeIds.length; i += 1000) {
          const res = await prisma.notification.createMany({
            data: attendeeIds.slice(i, i + 1000).map((userId) => ({
              userId,
              type: 'SYSTEM' as const,
              ...payload,
            })),
          });
          notified += res.count;
        }
        await pushService.sendToUsers(attendeeIds, payload);
      }

      // Host nudge — they're the one who has to press Start
      const hostPayload = {
        title: `Your room starts soon: ${room.title}`,
        body: 'Open the app and tap Start when you are ready to go live.',
        data: { roomId: room.id, startsAt },
      };
      await prisma.notification.create({
        data: { userId: room.hostId, type: 'SYSTEM', ...hostPayload },
      });
      await pushService.sendToUser(room.hostId, hostPayload);
      notified += 1;

      await prisma.audioRoom.update({ where: { id: room.id }, data: { reminderSentAt: new Date() } });
    }
    return { rooms: rooms.length, notified };
  },
};
