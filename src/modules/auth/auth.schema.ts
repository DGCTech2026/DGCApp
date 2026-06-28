import { z } from 'zod';

const e164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, 'Phone must be E.164 format, e.g. +2348012345678');

// Email OTP
export const requestOtpSchema = z.object({ email: z.string().email() });
export const verifyOtpSchema = z.object({ email: z.string().email(), code: z.string().length(6) });

// Phone OTP
export const requestPhoneOtpSchema = z.object({ phone: e164 });
export const verifyPhoneOtpSchema = z.object({ phone: e164, code: z.string().length(6) });

// OAuth
export const googleAuthSchema = z.object({ idToken: z.string().min(1) });
export const appleAuthSchema = z.object({ idToken: z.string().min(1) });

// Tokens
export const refreshTokenSchema = z.object({ refreshToken: z.string().min(1) });
