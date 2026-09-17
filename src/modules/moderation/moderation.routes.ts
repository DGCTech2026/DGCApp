import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSuperAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { reportMessageSchema, reportUserSchema, resolveReportSchema } from './moderation.schema';
import { moderationController } from './moderation.controller';

export const moderationRouter = Router();

// Report
moderationRouter.post(
  '/messages/:messageId/report',
  authenticate,
  validate(reportMessageSchema),
  asyncHandler(moderationController.reportMessage),
);
moderationRouter.post(
  '/users/:userId/report',
  authenticate,
  validate(reportUserSchema),
  asyncHandler(moderationController.reportUser),
);

// Block / unblock — the /me route MUST come before /:userId or Express matches "me" as a userId
moderationRouter.get('/users/me/blocked', authenticate, asyncHandler(moderationController.listBlocked));
moderationRouter.post('/users/:userId/block', authenticate, asyncHandler(moderationController.blockUser));
moderationRouter.delete('/users/:userId/block', authenticate, asyncHandler(moderationController.unblockUser));

// Admin: report management
moderationRouter.get('/reports', authenticate, requireSuperAdmin, asyncHandler(moderationController.listReports));
moderationRouter.post(
  '/reports/:reportId/resolve',
  authenticate,
  requireSuperAdmin,
  validate(resolveReportSchema),
  asyncHandler(moderationController.resolveReport),
);
