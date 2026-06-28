import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createEventSchema, rsvpSchema } from './events.schema';
import { eventController } from './events.controller';

export const eventsRouter = Router();

eventsRouter.get('/', authenticate, asyncHandler(eventController.list));
eventsRouter.post('/', authenticate, validate(createEventSchema), asyncHandler(eventController.create));
eventsRouter.get('/:eventId', authenticate, asyncHandler(eventController.get));
eventsRouter.post('/:eventId/rsvp', authenticate, validate(rsvpSchema), asyncHandler(eventController.rsvp));
eventsRouter.post('/:eventId/checkin', authenticate, asyncHandler(eventController.checkIn));
