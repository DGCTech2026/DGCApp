import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { prayerWatchController } from './prayer-watch.controller';

export const prayerWatchRouter = Router();

// Everyone can see the Global Prayer Watch channel id + whether a call is currently live.
// Drives the "Join Prayer Watch" banner on Home and gives the frontend the channelId for chat.
prayerWatchRouter.get('/', authenticate, asyncHandler(prayerWatchController.status));

// Any member (i.e. any authenticated user — all are auto-joined to the GPW channel) can start
// a call when none is live. Idempotent: if a call is already live, attaches the caller and returns
// the existing room + Agora token (audience if just joining, host if they were the starter).
prayerWatchRouter.post('/start', authenticate, asyncHandler(prayerWatchController.start));

// Force-end: Prayer Warriors cluster moderator or super admin only. Regular members leave via
// the standard /audio-rooms/:id/leave and the room auto-ends when the last participant leaves.
prayerWatchRouter.post('/:roomId/end', authenticate, asyncHandler(prayerWatchController.end));
