import type { RequestHandler } from 'express';
import {
  otpResendLimiter,
  otpEmailDailyLimiter,
  otpIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  passwordResetEmailLimiter,
  passwordResetIpLimiter,
} from '../infra/rateLimit';
import { TooManyRequests } from '../utils/errors';

// Guards OTP request (email or phone): per-IP hourly, per-identifier resend cooldown + daily cap.
// Mount AFTER the request validator so req.body.email / req.body.phone is present and valid.
export const otpRequestRateLimit: RequestHandler = async (req, _res, next) => {
  const identifier = String(req.body?.email ?? req.body?.phone ?? '').toLowerCase();
  const ip = req.ip ?? 'unknown';
  try {
    await otpIpLimiter.consume(ip);
    if (identifier) {
      await otpResendLimiter.consume(identifier);
      await otpEmailDailyLimiter.consume(identifier);
    }
    next();
  } catch {
    next(TooManyRequests('Too many OTP requests. Please wait and try again.'));
  }
};

// Guards password login: per-IP + per-email attempt caps (brute-force protection).
export const loginRateLimit: RequestHandler = async (req, _res, next) => {
  const email = String(req.body?.email ?? '').toLowerCase();
  const ip = req.ip ?? 'unknown';
  try {
    await loginIpLimiter.consume(ip);
    if (email) await loginEmailLimiter.consume(email);
    next();
  } catch {
    next(TooManyRequests('Too many login attempts. Please wait and try again.'));
  }
};

// Guards forgot/reset-password: per-IP + per-email caps.
export const passwordResetRateLimit: RequestHandler = async (req, _res, next) => {
  const email = String(req.body?.email ?? '').toLowerCase();
  const ip = req.ip ?? 'unknown';
  try {
    await passwordResetIpLimiter.consume(ip);
    if (email) await passwordResetEmailLimiter.consume(email);
    next();
  } catch {
    next(TooManyRequests('Too many password reset attempts. Please wait and try again.'));
  }
};
