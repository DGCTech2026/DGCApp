import type { Server } from 'socket.io';

// Holds the Socket.io server so services can broadcast without importing the HTTP wiring.
// Rooms: `channel:<id>` for each channel, `user:<id>` for direct/user-targeted events.
let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

export function emitToChannel(channelId: string, event: string, data: unknown) {
  io?.to(`channel:${channelId}`).emit(event, data);
}

export function emitToUser(userId: string, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}
