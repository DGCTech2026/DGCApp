import type { Server } from 'socket.io';

// Holds the Socket.io server so services can broadcast without importing the HTTP wiring.
// Rooms: `channel:<id>` for each channel, `user:<id>` for direct/user-targeted events.
let io: Server | null = null;
const channelRoomName = (channelId: string) => `channel:${channelId}`;

export function setIo(server: Server) {
  io = server;
}

export function getIo(): Server | null {
  return io;
}

export function emitToChannel(channelId: string, event: string, data: unknown) {
  io?.to(channelRoomName(channelId)).emit(event, data);
}

export function emitToUser(userId: string, event: string, data: unknown) {
  io?.to(`user:${userId}`).emit(event, data);
}

export function joinChannelRoom(userId: string, channelId: string) {
  io?.in(`user:${userId}`).socketsJoin(channelRoomName(channelId));
}

export function joinChannelRooms(userId: string, channelIds: string[]) {
  if (!channelIds.length) return;
  io?.in(`user:${userId}`).socketsJoin(channelIds.map(channelRoomName));
}

export function leaveChannelRoom(userId: string, channelId: string) {
  io?.in(`user:${userId}`).socketsLeave(channelRoomName(channelId));
}

// Audio rooms use their own socket rooms so one emit reaches every participant — no
// per-participant DB query + emit loop. Sockets are joined/left server-side through the
// user's `user:<id>` room, so the client never has to emit anything to subscribe.
const audioRoomName = (roomId: string) => `audio-room:${roomId}`;

export function emitToAudioRoom(roomId: string, event: string, data: unknown) {
  io?.to(audioRoomName(roomId)).emit(event, data);
}

export function joinAudioRoom(userId: string, roomId: string) {
  io?.in(`user:${userId}`).socketsJoin(audioRoomName(roomId));
}

export function leaveAudioRoom(userId: string, roomId: string) {
  io?.in(`user:${userId}`).socketsLeave(audioRoomName(roomId));
}

export function closeAudioRoom(roomId: string) {
  io?.in(audioRoomName(roomId)).socketsLeave(audioRoomName(roomId));
}
