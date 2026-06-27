import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { otpRequestRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { requestOtpSchema, verifyOtpSchema, refreshTokenSchema, googleAuthSchema } from './auth.schema';
import { authController } from './auth.controller';

export const authRouter = Router();

// Public
authRouter.post(
  '/email/request-otp',
  validate(requestOtpSchema),
  otpRequestRateLimit,
  asyncHandler(authController.requestOtp),
);
authRouter.post('/email/verify-otp', validate(verifyOtpSchema), asyncHandler(authController.verifyOtp));
authRouter.post('/google', validate(googleAuthSchema), asyncHandler(authController.google));
authRouter.post('/refresh', validate(refreshTokenSchema), asyncHandler(authController.refresh));

// Authenticated
authRouter.post('/logout', authenticate, validate(refreshTokenSchema), asyncHandler(authController.logout));
