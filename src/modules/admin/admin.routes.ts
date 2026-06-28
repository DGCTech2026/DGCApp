import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requireSuperAdmin } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { createBranchSchema, setRoleSchema, assignUserSchema } from './admin.schema';
import { adminController } from './admin.controller';

export const adminRouter = Router();

// Every admin route is global super-admin only.
adminRouter.use(authenticate, requireSuperAdmin);

adminRouter.get('/analytics', asyncHandler(adminController.analytics));
adminRouter.get('/users', asyncHandler(adminController.listUsers));
adminRouter.post('/users/:userId/suspend', asyncHandler(adminController.suspend));
adminRouter.post('/users/:userId/unsuspend', asyncHandler(adminController.unsuspend));
adminRouter.post('/users/:userId/role', validate(setRoleSchema), asyncHandler(adminController.setRole));
adminRouter.post('/branches', validate(createBranchSchema), asyncHandler(adminController.createBranch));
adminRouter.post('/branches/:branchId/admins', validate(assignUserSchema), asyncHandler(adminController.assignBranchAdmin));
adminRouter.post('/clusters/:clusterId/archive', asyncHandler(adminController.archiveCluster));
adminRouter.post('/clusters/:clusterId/unarchive', asyncHandler(adminController.unarchiveCluster));
