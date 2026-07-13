import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../utils/jwt';
import { prisma } from '../../infra/db';
import { redis } from '../../infra/redis';
import { logger } from '../../infra/logger';

const PRESENCE_TTL = 120; // seconds — refreshed every heartbeat; expires = offline
const PRESENCE_KEY = (uid: string) => `presence:${uid}`;

type PresenceStatus = 'online' | 'away' | 'offline';

export async function getUserPresence(userId: string): Promise<PresenceStatus> {
  const val = await redis.get(PRESENCE_KEY(userId));
  return (val as PresenceStatus) || 'offline';
}

export async function getBulkPresence(userIds: string[]): Promise<Record<string, PresenceStatus>> {
  if (!userIds.length) return {};
  const pipeline = redis.pipeline();
  for (const id of userIds) pipeline.get(PRESENCE_KEY(id));
  const results = await pipeline.exec();
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

  io.on('connection', async (socket: Socket) => {
    const userId = socket.data.user.sub as string;
    socket.join(`user:${userId}`);

    // --- Presence: mark online ---
    await redis.set(PRESENCE_KEY(userId), 'online', 'EX', PRESENCE_TTL);
    socket.broadcast.emit('presence', { userId, status: 'online' });

    // Join channel rooms
    try {
      const memberships = await prisma.channelMembership.findMany({
        where: { userId },
        select: { channelId: true },
      });
      for (const m of memberships) socket.join(`channel:${m.channelId}`);
    } catch (err) {
      logger.error({ err, userId }, 'Failed to join channel rooms');
    }

    // --- Presence heartbeat: frontend sends every 60s to stay online ---
    socket.on('presence:heartbeat', async (payload?: { status?: string }) => {
      const status = payload?.status === 'away' ? 'away' : 'online';
      await redis.set(PRESENCE_KEY(userId), status, 'EX', PRESENCE_TTL);
      socket.broadcast.emit('presence', { userId, status });
    });

    // --- Typing indicators ---
    socket.on('typing:start', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:start', {
          channelId: payload.channelId,
          userId,
        });
      }
    });

    socket.on('typing:stop', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:stop', {
          channelId: payload.channelId,
          userId,
        });
      }
    });

    // Legacy alias
    socket.on('channel:typing', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('typing:start', {
          channelId: payload.channelId,
          userId,
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
        await redis.del(PRESENCE_KEY(userId));
        socket.broadcast.emit('presence', { userId, status: 'offline' });
      }
    });
  });

  logger.info('Socket.io handlers registered');
}
