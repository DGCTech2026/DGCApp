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

// Reduced from 300s → 30s: if the phone ever caches an empty response (from a poisoned
// server-cache moment before the skipCacheIfEmpty guard was in place), the bad state clears in
// 30s instead of 5 min. Onboarding flow doesn't need long client cache — one request per user.
branchesRouter.get('/', cacheControl(30), asyncHandler(branchController.list));
branchesRouter.get('/:id', cacheControl(30), asyncHandler(branchController.get));

// Branch announcements (PRD §3) — read for members; post for the branch's admin or a super admin.
branchesRouter.get('/:branchId/announcements', authenticate, asyncHandler(announcementController.listBranch));
branchesRouter.post(
  '/:branchId/announcements',
  authenticate,
  validate(postAnnouncementSchema),
  asyncHandler(announcementController.postBranch),
);
