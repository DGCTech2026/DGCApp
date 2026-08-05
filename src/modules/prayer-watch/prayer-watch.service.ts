import { prisma } from '../../infra/db';
import { joinAudioRoom, emitToAudioRoom, closeAudioRoom } from '../../infra/realtime';
import { notificationQueue } from '../../infra/queue';
import { audioRoomService } from '../audio-rooms/audio-rooms.service';
import { isClusterModerator } from '../../utils/authorization';
import { BadRequest, Forbidden, NotFound } from '../../utils/errors';

// The Prayer Warriors cluster hosts the 24hr Prayer Watch. Seeded — slug is stable.
const PRAYER_WATCH_CLUSTER_SLUG = 'prayer-warriors';
const PRAYER_WATCH_TITLE = 'Prayer Watch';

async function requirePrayerWatchCluster() {
  const cluster = await prisma.cluster.findUnique({
    where: { slug: PRAYER_WATCH_CLUSTER_SLUG },
    select: { id: true },
  });
  if (!cluster) throw NotFound('Prayer Warriors cluster is not configured');
  return cluster.id;
}

// Moderator check: super admin OR cluster moderator of the Prayer Warriors cluster.
async function requirePrayerWatchModerator(userId: string, role: string) {
  if (role === 'SUPER_ADMIN') return;
  const clusterId = await requirePrayerWatchCluster();
  if (!(await isClusterModerator(userId, clusterId))) {
    throw Forbidden('Only Prayer Warriors moderators can start or end the Prayer Watch');
  }
}

export const prayerWatchService = {
  // Returns the current live Prayer Watch room, or null if none is live. Used by the client to
  // decide whether to render a "Join the ongoing Prayer Watch" banner on Home.
  async getLive() {
    const room = await prisma.audioRoom.findFirst({
      where: { type: 'PRAYER_WATCH', status: 'LIVE' },
      orderBy: { startedAt: 'desc' },
      select: { id: true, title: true, hostId: true, startedAt: true },
    });
    return room;
  },

  // Cluster moderator starts a Prayer Watch. If one is already live, returns it (idempotent —
  // two moderators tapping "Start" at the same time both land on the same room).
  async start(userId: string, role: string) {
    await requirePrayerWatchModerator(userId, role);
    const clusterId = await requirePrayerWatchCluster();

    const existing = await this.getLive();
    if (existing) {
      // Attach the caller as HOST if they aren't already in the room, so they can moderate.
      const p = await prisma.audioRoomParticipant.findFirst({
        where: { roomId: existing.id, userId, leftAt: null },
        select: { id: true, role: true },
      });
      if (!p) {
        await prisma.audioRoomParticipant.create({
          data: { roomId: existing.id, userId, role: 'HOST' },
        });
        joinAudioRoom(userId, existing.id);
      }
      const detail = await audioRoomService.get(userId, existing.id);
      return { ...detail, agora: audioRoomService.issueToken(existing.id, userId, 'host'), alreadyLive: true };
    }

    const room = await prisma.audioRoom.create({
      data: {
        title: PRAYER_WATCH_TITLE,
        description: '24hr Prayer Watch',
        clusterId,
        hostId: userId,
        type: 'PRAYER_WATCH',
        isPersistent: true,
        status: 'LIVE',
        provider: 'agora',
        startedAt: new Date(),
        participants: { create: { userId, role: 'HOST' } },
      },
      select: { id: true, title: true },
    });

    joinAudioRoom(userId, room.id);

    // Fan out "Prayer Watch is live" push to every user. Runs off the request path — the moderator
    // sees the room come up instantly, notifications trickle out to the org via the worker.
    await notificationQueue.add(
      'prayer-watch-live-fanout',
      { roomId: room.id, title: room.title, startedById: userId },
      { jobId: `prayer-watch-live:${room.id}`, removeOnComplete: true, attempts: 3 },
    );

    const detail = await audioRoomService.get(userId, room.id);
    return { ...detail, agora: audioRoomService.issueToken(room.id, userId, 'host'), alreadyLive: false };
  },

  // Cluster moderator ends the current Prayer Watch. Requires cluster-mod (or super admin) — a
  // regular HOST leaving does not end a persistent room (audio-rooms.service.leave respects that).
  async end(userId: string, role: string, roomId: string) {
    await requirePrayerWatchModerator(userId, role);
    const room = await prisma.audioRoom.findUnique({
      where: { id: roomId },
      select: { type: true, status: true },
    });
    if (!room || room.type !== 'PRAYER_WATCH') throw NotFound('Prayer Watch not found');
    if (room.status === 'ENDED') throw BadRequest('Prayer Watch already ended');

    await prisma.audioRoom.update({
      where: { id: roomId },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    await prisma.audioRoomParticipant.updateMany({
      where: { roomId, leftAt: null },
      data: { leftAt: new Date() },
    });

    emitToAudioRoom(roomId, 'audio-room:ended', { roomId });
    closeAudioRoom(roomId);
    return { ok: true };
  },
};
