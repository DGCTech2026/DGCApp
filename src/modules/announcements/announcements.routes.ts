import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSuperAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { postAnnouncementSchema, announcementAdminSchema } from './announcements.schema';
import { announcementController } from './announcements.controller';

export const announcementsRouter = Router();

// Read feed — any authenticated member (Home → Announcements, PRD §14).
announcementsRouter.get('/', authenticate, asyncHandler(announcementController.list));
// Post — super admin OR an authorized announcement admin (the service enforces).
announcementsRouter.post('/', authenticate, validate(postAnnouncementSchema), asyncHandler(announcementController.post));

// Announcement-admin management — super admin only (PRD §4).
announcementsRouter.get('/admins', authenticate, requireSuperAdmin, asyncHandler(announcementController.listAdmins));
announcementsRouter.post(
  '/admins',
  authenticate,
  requireSuperAdmin,
  validate(announcementAdminSchema),
  asyncHandler(announcementController.grantAdmin),
);
announcementsRouter.delete(
  '/admins/:userId',
  authenticate,
  requireSuperAdmin,
  asyncHandler(announcementController.revokeAdmin),
);
