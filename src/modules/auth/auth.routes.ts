import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authenticate } from '../../middleware/authenticate';
import { otpRequestRateLimit, loginRateLimit, passwordResetRateLimit } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  requestOtpSchema,
  requestPhoneOtpSchema,
  googleAuthSchema,
  appleAuthSchema,
  registerSchema,
  verifyOtpUnifiedSchema,
  loginSchema,
  setPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from './auth.schema';
import { authController } from './auth.controller';

export const authRouter = Router();

// Registration: submit the Create Account form, then verify the emailed code via /verify-otp.
authRouter.post('/register', validate(registerSchema), otpRequestRateLimit, asyncHandler(authController.register));

// THE verify endpoint (email or phone): completes a pending registration, else passwordless sign-in.
authRouter.post('/verify-otp', validate(verifyOtpUnifiedSchema), asyncHandler(authController.verify));

// Email OTP (public)
authRouter.post(
  '/email/request-otp',
  validate(requestOtpSchema),
  otpRequestRateLimit,
  asyncHandler(authController.requestOtp),
);

// Phone OTP (public) — gated on SMS provider config
authRouter.post(
  '/phone/request-otp',
  validate(requestPhoneOtpSchema),
  otpRequestRateLimit,
  asyncHandler(authController.requestPhoneOtp),
);

// OAuth (public)
authRouter.post('/google', validate(googleAuthSchema), asyncHandler(authController.google));
authRouter.post('/apple', validate(appleAuthSchema), asyncHandler(authController.apple));

// Password (public login + reset; set/change requires auth)
authRouter.post('/login', validate(loginSchema), loginRateLimit, asyncHandler(authController.login));
authRouter.post(
  '/password/request-otp',
  validate(requestOtpSchema),
  otpRequestRateLimit,
  asyncHandler(authController.requestPasswordResetOtp),
);
authRouter.post(
  '/reset-password',
  validate(resetPasswordSchema),
  passwordResetRateLimit,
  asyncHandler(authController.resetPassword),
);
authRouter.post('/password', authenticate, validate(setPasswordSchema), asyncHandler(authController.setPassword));

// Tokens
authRouter.post('/refresh', validate(refreshTokenSchema), asyncHandler(authController.refresh));
authRouter.post('/logout', authenticate, validate(refreshTokenSchema), asyncHandler(authController.logout));
