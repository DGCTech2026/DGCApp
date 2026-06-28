import { Router } from 'express';
import { authRouter } from './modules/auth/auth.routes';
import { usersRouter } from './modules/users/users.routes';
import { branchesRouter } from './modules/branches/branches.routes';
import { mediaRouter } from './modules/media/media.routes';
import { channelsRouter } from './modules/channels/channels.routes';
import { messagesRouter } from './modules/chat/chat.routes';
// import { clustersRouter } from './modules/clusters/clusters.routes';
// import { growthRouter } from './modules/growth/growth.routes';
// import { eventsRouter } from './modules/events/events.routes';
// import { mediaRouter } from './modules/media/media.routes';
// import { notificationsRouter } from './modules/notifications/notifications.routes';
// import { adminRouter } from './modules/admin/admin.routes';

export const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/branches', branchesRouter);
router.use('/media', mediaRouter);
router.use('/channels', channelsRouter);
router.use('/messages', messagesRouter);
// Uncomment as each module is built:
// router.use('/clusters', clustersRouter);
// router.use('/growth', growthRouter);
// router.use('/events', eventsRouter);
// router.use('/media', mediaRouter);
// router.use('/notifications', notificationsRouter);
// router.use('/admin', adminRouter);
