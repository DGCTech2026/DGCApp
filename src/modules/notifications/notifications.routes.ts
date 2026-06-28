import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { asyncHandler } from '../../utils/asyncHandler';
import { notificationController } from './notifications.controller';

export const notificationsRouter = Router();

notificationsRouter.get('/', authenticate, asyncHandler(notificationController.list));
notificationsRouter.post('/read-all', authenticate, asyncHandler(notificationController.markAllRead));
notificationsRouter.post('/:id/read', authenticate, asyncHandler(notificationController.markRead));
