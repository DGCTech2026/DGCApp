import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { userService } from '../users/users.service';
import { channelService } from '../channels/channels.service';
import { notificationService } from '../notifications/notifications.service';
import { audioRoomService } from '../audio-rooms/audio-rooms.service';
import { eventService } from '../events/events.service';

export const bootstrapRouter = Router();

// Everything the app needs to render after launch, in ONE round trip. On a high-latency
// connection this replaces 5 sequential GETs (me → channels → notifications → audio rooms →
// events) with a single request; server-side the five reads run in parallel, so the response
// takes only as long as the slowest one.
bootstrapRouter.get(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const userId = req.user!.sub;
    const [me, channels, notifications, liveAudioRooms, upcomingEvents] = await Promise.all([
      userService.getMe(userId),
      channelService.listMine(userId),
      notificationService.listMine(userId),
      audioRoomService.list(userId, 'live'),
      eventService.listUpcoming(userId),
    ]);
    res.json({ me, channels, notifications, liveAudioRooms, upcomingEvents });
  }),
);
