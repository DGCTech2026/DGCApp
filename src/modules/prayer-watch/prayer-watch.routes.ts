import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { prayerWatchController } from './prayer-watch.controller';

export const prayerWatchRouter = Router();

// Everyone can see if a Prayer Watch is live (drives the "Join Prayer Watch" banner on Home).
prayerWatchRouter.get('/', authenticate, asyncHandler(prayerWatchController.getLive));

// Start / end — cluster moderator of Prayer Warriors (or super admin). Idempotent start:
// if a Prayer Watch is already live, returns it and attaches the caller as HOST.
prayerWatchRouter.post('/start', authenticate, asyncHandler(prayerWatchController.start));
prayerWatchRouter.post('/:roomId/end', authenticate, asyncHandler(prayerWatchController.end));
