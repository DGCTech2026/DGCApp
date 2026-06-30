import { z } from 'zod';

const e164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 format, e.g. +2348012345678');

// OTP requests (the code is verified at /auth/verify-otp via verifyOtpUnifiedSchema)
export const requestOtpSchema = z.object({ email: z.string().email() });
export const requestPhoneOtpSchema = z.object({ phone: e164 });

// OAuth
export const googleAuthSchema = z.object({ idToken: z.string().min(1) });
export const appleAuthSchema = z.object({ idToken: z.string().min(1) });

// Registration (single submit of the Create Account form; then verify the emailed code)
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(100),
  phoneNumber: e164.optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
  dateOfBirth: z.coerce.date().optional(),
  occupation: z.string().max(120).optional(),
  branchId: z.string().min(1).optional(),
});
// Verify (email or phone) — identifier must match the one the code was sent to.
export const verifyOtpUnifiedSchema = z.object({
  identifier: z.string().min(3),
  code: z.string().length(6),
});
export type RegisterInput = z.infer<typeof registerSchema>;

// Password
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
export const setPasswordSchema = z.object({
  password: z.string().min(8).max(128),
  currentPassword: z.string().optional(), // required only when changing an existing password
});
export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  newPassword: z.string().min(8).max(128),
});

// Tokens
export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });
