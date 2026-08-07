import { prisma } from '../../infra/db';
import { joinAudioRoom, emitToAudioRoom, closeAudioRoom } from '../../infra/realtime';

// Shape must match audio-rooms.service.PARTICIPANT_SELECT so all clients render the same fields.
const PARTICIPANT_SELECT = {
  id: true,
  userId: true,
  role: true,
  joinedAt: true,
  user: { select: { id: true, displayName: true, avatarUrl: true } },
} as const;
import { notificationQueue } from '../../infra/queue';
import { audioRoomService } from '../audio-rooms/audio-rooms.service';
import { isClusterModerator } from '../../utils/authorization';
import { BadRequest, Forbidden, NotFound } from '../../utils/errors';

// PRD clarification: Global Prayer Watch is a singleton channel every user is auto-joined to.
// It works as an ordinary chat channel PLUS members can spin up a live prayer audio call inside
// it. Only one live call at a time. The call is a persistent AudioRoom (type=PRAYER_WATCH) that
// stays live even if the starter leaves — it only ends when the last participant leaves, or when
// a Prayer Warriors cluster moderator / super admin force-ends it.
const PRAYER_WARRIORS_CLUSTER_SLUG = 'prayer-warriors';
const PRAYER_WATCH_ROOM_TITLE = 'Global Prayer Watch';

async function findGlobalPrayerWatchChannel() {
  const channel = await prisma.channel.findFirst({
    where: { type: 'GLOBAL_PRAYER_WATCH' },
    select: { id: true },
  });
  if (!channel) throw NotFound('Global Prayer Watch channel is not configured');
  return channel;
}

// Force-end permission: super admin, or a moderator of the Prayer Warriors cluster.
// A regular member never force-ends — they just leave, and the room auto-ends when the last
// participant leaves.
async function requireForceEndPermission(userId: string, role: string) {
  if (role === 'SUPER_ADMIN') return;
  const cluster = await prisma.cluster.findUnique({
    where: { slug: PRAYER_WARRIORS_CLUSTER_SLUG },
    select: { id: true },
  });
  if (!cluster) throw NotFound('Prayer Warriors cluster is not configured');
  if (!(await isClusterModerator(userId, cluster.id))) {
    throw Forbidden('Only Prayer Warriors moderators or super admins can force-end the Prayer Watch call');
  }
}

async function findLiveRoom() {
  return prisma.audioRoom.findFirst({
    where: { type: 'PRAYER_WATCH', status: 'LIVE' },
    orderBy: { startedAt: 'desc' },
    select: { id: true, title: true, hostId: true, startedAt: true, createdAt: true },
  });
}

export const prayerWatchService = {
  // What the client polls on Home. Returns the GPW channel id + the currently-live call (if any).
  // channelId lets the client also fetch chat messages / send messages via the standard endpoints.
  async status() {
    const channel = await findGlobalPrayerWatchChannel();
    const live = await findLiveRoom();
    return { channelId: channel.id, live };
  },

  // Any authenticated user (they're all members of the GPW channel) can start a call — but only
  // when none is currently live. If a call is already live, we attach the caller as a LISTENER
  // (so their client can join without duplicating state) and return the same room + audience token.
  async start(userId: string, _role: string) {
    await findGlobalPrayerWatchChannel(); // ensures the channel exists — catches misconfigured envs

    const existing = await findLiveRoom();
    if (existing) {
      // Attach caller if not already in the room; return the existing room + audience token.
      const p = await prisma.audioRoomParticipant.findFirst({
        where: { roomId: existing.id, userId, leftAt: null },
        select: { id: true, role: true },
      });
      let participantRole: 'HOST' | 'SPEAKER' | 'LISTENER';
      if (!p) {
        const created = await prisma.audioRoomParticipant.create({
          data: { roomId: existing.id, userId, role: 'LISTENER' },
          select: PARTICIPANT_SELECT,
        });
        joinAudioRoom(userId, existing.id);
        // Notify everyone else in the room that this user just joined — mirrors the standard
        // audio-rooms.join() flow. Without this the host never sees the new listener appear.
        emitToAudioRoom(existing.id, 'audio-room:user-joined', created);
        participantRole = 'LISTENER';
      } else {
        participantRole = p.role;
      }
      const detail = await audioRoomService.get(userId, existing.id);
      const agoraRole = participantRole === 'LISTENER' ? 'audience' : 'host';
      return {
        ...detail,
        agora: audioRoomService.issueToken(existing.id, userId, agoraRole),
        alreadyLive: true,
      };
    }

    // No live call — create one. Starter is HOST; room is persistent so it survives the starter
    // leaving. isPersistent + type=PRAYER_WATCH together instruct leave() to end the room only
    // when the LAST participant leaves.
    const room = await prisma.audioRoom.create({
      data: {
        title: PRAYER_WATCH_ROOM_TITLE,
        description: 'Live prayer call in the Global Prayer Watch channel',
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

    // Fan out "Prayer Watch call is live" push to every registered user (worker pages the User
    // table). Runs off the request path — starter sees the room instantly.
    await notificationQueue.add(
      'prayer-watch-live-fanout',
      { roomId: room.id, title: room.title, startedById: userId },
      { jobId: `prayer-watch-live:${room.id}`, removeOnComplete: true, attempts: 3 },
    );

    const detail = await audioRoomService.get(userId, room.id);
    return { ...detail, agora: audioRoomService.issueToken(room.id, userId, 'host'), alreadyLive: false };
  },

  // Force-end: Prayer Warriors moderator or super admin. Ends the call for everyone still on it.
  // Regular participants leaving just call the standard /audio-rooms/:id/leave and the room
  // auto-ends when the last one leaves (see audio-rooms.service.leave for persistent-room rules).
  async end(userId: string, role: string, roomId: string) {
    await requireForceEndPermission(userId, role);
    const room = await prisma.audioRoom.findUnique({
      where: { id: roomId },
      select: { type: true, status: true },
    });
    if (!room || room.type !== 'PRAYER_WATCH') throw NotFound('Prayer Watch call not found');
    if (room.status === 'ENDED') throw BadRequest('Prayer Watch call already ended');

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
