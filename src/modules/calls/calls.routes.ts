import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { callsController } from './calls.controller';
import { initiateCallSchema } from './calls.schema';

export const dmsRouter = Router();
export const callsRouter = Router();

// Mounted at /dms. DM-scoped call initiation + history.
dmsRouter.get('/:channelId/calls', authenticate, asyncHandler(callsController.listForDm));
dmsRouter.post(
  '/:channelId/calls',
  authenticate,
  validate(initiateCallSchema),
  asyncHandler(callsController.initiate),
);

// Mounted at /calls. Call lifecycle operations.
callsRouter.post('/:callId/answer', authenticate, asyncHandler(callsController.answer));
callsRouter.post('/:callId/decline', authenticate, asyncHandler(callsController.decline));
callsRouter.post('/:callId/end', authenticate, asyncHandler(callsController.end));
callsRouter.post('/:callId/token', authenticate, asyncHandler(callsController.token));
