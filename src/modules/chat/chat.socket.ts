import type { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../../utils/jwt';
import { prisma } from '../../infra/db';
import { logger } from '../../infra/logger';

// Authenticates each socket with the same access token as REST, then joins the user to a room
// per channel they belong to. Message/reaction broadcasts (from chat.service) land in those rooms.
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
    try {
      const memberships = await prisma.channelMembership.findMany({
        where: { userId },
        select: { channelId: true },
      });
      for (const m of memberships) socket.join(`channel:${m.channelId}`);
    } catch (err) {
      logger.error({ err, userId }, 'Failed to join channel rooms');
    }

    // Ephemeral typing indicator — broadcast to others in the channel, not persisted.
    socket.on('channel:typing', (payload: { channelId?: string }) => {
      if (payload?.channelId) {
        socket.to(`channel:${payload.channelId}`).emit('channel:typing', { channelId: payload.channelId, userId });
      }
    });

    // Join a room for a channel created after connect (e.g. a freshly opened DM). Membership-checked.
    socket.on('channel:join', async (payload: { channelId?: string }) => {
      if (!payload?.channelId) return;
      const m = await prisma.channelMembership.findUnique({
        where: { userId_channelId: { userId, channelId: payload.channelId } },
      });
      if (m) socket.join(`channel:${payload.channelId}`);
    });
  });

  logger.info('Socket.io handlers registered');
}
