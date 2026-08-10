import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';

import { asyncHandler } from '../../utils/asyncHandler';
import { postAnnouncementSchema } from '../announcements/announcements.schema';
import { announcementController } from '../announcements/announcements.controller';
import { branchController } from './branches.controller';

// Public read endpoints — power the registration branch picker.
export const branchesRouter = Router();

// No HTTP cache — this powers the onboarding branch picker and must never serve a stale empty
// response from the device's HTTP cache. Server-side Redis cache (5 min, skipCacheIfEmpty)
// handles the performance; the client always gets a fresh answer.
branchesRouter.get('/', asyncHandler(branchController.list));
branchesRouter.get('/:id', asyncHandler(branchController.get));

// Branch announcements (PRD §3) — read for members; post for the branch's admin or a super admin.
branchesRouter.get('/:branchId/announcements', authenticate, asyncHandler(announcementController.listBranch));
branchesRouter.post(
  '/:branchId/announcements',
  authenticate,
  validate(postAnnouncementSchema),
  asyncHandler(announcementController.postBranch),
);
