import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../utils/jwt';
import { prisma } from '../../infra/db';
import { redis, withDeadline } from '../../infra/redis';
import { logger } from '../../infra/logger';

const PRESENCE_TTL = 120; // seconds — refreshed every heartbeat; expires = offline
const PRESENCE_KEY = (uid: string) => `presence:${uid}`;

type PresenceStatus = 'online' | 'away' | 'offline';

// Presence reads race a short deadline: if Redis is slow/unreachable, everyone reads as
// 'offline' and the request proceeds — an online dot is never worth stalling the chat list for.
export async function getUserPresence(userId: string): Promise<PresenceStatus> {
  const val = await withDeadline(redis.get(PRESENCE_KEY(userId)), 300, null);
  return (val as PresenceStatus) || 'offline';
}

export async function getBulkPresence(userIds: string[]): Promise<Record<string, PresenceStatus>> {
  if (!userIds.length) return {};
  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.get(PRESENCE_KEY(id));
  const results = await withDeadline(pipeline.exec(), 300, null);
  const out: Record<string, PresenceStatus> = {};
  userIds.forEach((id, i) => {
    const val = results?.[i]?.[1] as string | null;
    out[id] = (val as PresenceStatus) || 'offline';
  });
  return out;
}

export function registerSocketHandlers(io: Server) {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.['token'] as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    try {
      socket.data.user = verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  // Refresh the presence TTL and report whether the visible status changed. Callers broadcast
  // only on change — re-broadcasting every heartbeat is an O(users²) storm for zero information.
  async function setPresence(userId: string, status: PresenceStatus): Promise<boolean> {
    const results = await withDeadline(
      redis.pipeline().get(PRESENCE_KEY(userId)).set(PRESENCE_KEY(userId), status, 'EX', PRESENCE_TTL).exec(),
      500,
      null,
    );
    if (!results) return false; // Redis unreachable — skip the broadcast, don't stall the socket
    const previous = (results[0]?.[1] as string | null) ?? 'offline';
    return previous !== status;
  }

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.user.sub as string;
    socket.join(`user:${userId}`);

    // --- Presence: mark online (broadcast only on an actual offline/away → online change) ---
    if (await setPresence(userId, 'online')) {
      socket.broadcast.emit('presence', { userId, status: 'online' });
    }

    // Fetch display name (for typing indicators) alongside channel/room memberships in one round.
    let displayName: string | null = null;
    try {
      const [user, memberships, audioRooms] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { displayName: true } }),
        prisma.channelMembership.findMany({ where: { userId }, select: { channelId: true } }),
        prisma.audioRoomParticipant.findMany({
          where: { userId, leftAt: null, room: { status: 'LIVE' } },
          select: { roomId: true },
        }),
      ]);
      displayName = user?.displayName ?? null;
      for (const m of memberships) socket.join(`channel:${m.channelId}`);
      for (const r of audioRooms) socket.join(`audio-room:${r.roomId}`);
    } catch (err) {
      logger.error({ err, userId }, 'Failed to join channel rooms');
    }

    // --- Presence heartbeat: frontend sends every 60s to stay online ---
    socket.on('presence:heartbeat', async (payload?: { status?: string }) => {
      const status: PresenceStatus = payload?.status === 'away' ? 'away' : 'online';
      if (await setPresence(userId, status)) {
        socket.broadcast.emit('presence', { userId, status });
      }
    });

    // --- Typing indicators ---
    socket.on('typing:start', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:start', {
          channelId: payload.channelId,
          userId,
          displayName,
        });
      }
    });

    socket.on('typing:stop', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:stop', {
          channelId: payload.channelId,
          userId,
          displayName,
        });
      }
    });

    // Legacy alias
    socket.on('channel:typing', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:start', {
          channelId: payload.channelId,
          userId,
          displayName,
        });
      }
    });

    // --- Mark channel as read via socket (no REST call needed) ---
    socket.on('channel:markRead', async (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      try {
        await prisma.channelMembership.updateMany({
          where: { userId, channelId: payload.channelId },
          data: { lastReadAt: new Date() },
        });
      } catch { /* silently ignore if not a member */ }
    });

    // Join a room for a channel created after connect (e.g. a freshly opened DM).
    socket.on('channel:join', async (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      const m = await prisma.channelMembership.findUnique({
        where: { userId_channelId: { userId, channelId: payload.channelId } },
      });
      if (m) socket.join(`channel:${payload.channelId}`);
    });

    // --- Disconnect: mark offline ---
    socket.on('disconnect', async () => {
      // Check if user has other active sockets (multi-device)
      const rooms = await io.in(`user:${userId}`).fetchSockets();
      if (rooms.length === 0) {
        const deleted = await redis.del(PRESENCE_KEY(userId));
        // Only announce if they were actually visible as online/away (TTL may have expired already).
        if (deleted > 0) socket.broadcast.emit('presence', { userId, status: 'offline' });
      }
    });
  });

  logger.info('Socket.io handlers registered');
}
