import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { updateMeSchema, registerDeviceSchema, removeDeviceSchema } from './users.schema';
import { userController } from './users.controller';

export const usersRouter = Router();

usersRouter.get('/me', authenticate, asyncHandler(userController.getMe));
usersRouter.get('/:userId', authenticate, asyncHandler(userController.getProfile));
usersRouter.patch('/me', authenticate, validate(updateMeSchema), asyncHandler(userController.updateMe));
usersRouter.delete('/me', authenticate, asyncHandler(userController.deleteMe));

// Push device tokens (FCM) — register after login, unregister on logout.
usersRouter.post('/me/devices', authenticate, validate(registerDeviceSchema), asyncHandler(userController.registerDevice));
usersRouter.delete('/me/devices', authenticate, validate(removeDeviceSchema), asyncHandler(userController.removeDevice));
