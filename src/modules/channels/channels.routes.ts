import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { openDmSchema } from './channels.schema';
import { sendMessageSchema } from '../chat/chat.schema';
import { channelController } from './channels.controller';
import { chatController } from '../chat/chat.controller';

export const channelsRouter = Router();

channelsRouter.get('/', authenticate, asyncHandler(channelController.listMine));
channelsRouter.post('/dm', authenticate, validate(openDmSchema), asyncHandler(channelController.openDm));
channelsRouter.get('/:channelId', authenticate, asyncHandler(channelController.get));
channelsRouter.post('/:channelId/read', authenticate, asyncHandler(channelController.markRead));
channelsRouter.get('/:channelId/messages', authenticate, asyncHandler(chatController.list));
channelsRouter.post(
  '/:channelId/messages',
  authenticate,
  validate(sendMessageSchema),
  asyncHandler(chatController.send),
);
