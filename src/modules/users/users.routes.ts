import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { updateMeSchema } from './users.schema';
import { userController } from './users.controller';

export const usersRouter = Router();

usersRouter.get('/me', authenticate, asyncHandler(userController.getMe));
usersRouter.patch('/me', authenticate, validate(updateMeSchema), asyncHandler(userController.updateMe));
usersRouter.delete('/me', authenticate, asyncHandler(userController.deleteMe));
