import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { cacheControl } from '../../middleware/cacheControl';
import { asyncHandler } from '../../utils/asyncHandler';
import { postAnnouncementSchema } from '../announcements/announcements.schema';
import { announcementController } from '../announcements/announcements.controller';
import { branchController } from './branches.controller';

// Public read endpoints — power the registration branch picker.
export const branchesRouter = Router();

branchesRouter.get('/', cacheControl(300), asyncHandler(branchController.list));
branchesRouter.get('/:id', cacheControl(300), asyncHandler(branchController.get));

// Branch announcements (PRD §3) — read for members; post for the branch's admin or a super admin.
branchesRouter.get('/:branchId/announcements', authenticate, asyncHandler(announcementController.listBranch));
branchesRouter.post(
  '/:branchId/announcements',
  authenticate,
  validate(postAnnouncementSchema),
  asyncHandler(announcementController.postBranch),
);
