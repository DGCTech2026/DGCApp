import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { reactionSchema } from './chat.schema';
import { chatController } from './chat.controller';

// Mounted at /messages — message-scoped operations.
export const messagesRouter = Router();

messagesRouter.post('/:messageId/reactions', authenticate, validate(reactionSchema), asyncHandler(chatController.addReaction));
messagesRouter.delete('/:messageId/reactions', authenticate, validate(reactionSchema), asyncHandler(chatController.removeReaction));
messagesRouter.post('/:messageId/pin', authenticate, asyncHandler(chatController.pin));
messagesRouter.post('/:messageId/unpin', authenticate, asyncHandler(chatController.unpin));
messagesRouter.delete('/:messageId', authenticate, asyncHandler(chatController.remove));
