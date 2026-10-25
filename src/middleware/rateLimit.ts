import type { RequestHandler } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import {
  consumeWhenAvailable,
  otpResendLimiter,
  otpEmailDailyLimiter,
  otpIpLimiter,
  loginEmailLimiter,
  loginIpLimiter,
  passwordResetEmailLimiter,
  passwordResetIpLimiter,
} from '../infra/rateLimit';
import { TooManyRequests } from '../utils/errors';

const OTP_LIMIT_MESSAGE = 'Too many OTP requests. Please wait and try again.';

// Per-IP cap only. Registration applies the per-email cooldown in authService.register so a
// slow-network double tap can replay the first attempt instead of failing the signup.
export const otpIpRateLimit: RequestHandler = async (req, _res, next) => {
  const ip = req.ip ?? 'unknown';
  try {
    await consumeWhenAvailable(otpIpLimiter, ip);
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) return next(TooManyRequests(OTP_LIMIT_MESSAGE));
    next();
  }
};

// Guards OTP request (email or phone): per-IP hourly, per-identifier resend cooldown + daily cap.
// Mount AFTER the request validator so req.body.email / req.body.phone is present and valid.
// A Redis error allows the request. Only a real limit answers 429.
export const otpRequestRateLimit: RequestHandler = async (req, _res, next) => {
  const identifier = String(req.body?.email ?? req.body?.phone ?? '').toLowerCase();
  const ip = req.ip ?? 'unknown';
  try {
    await consumeWhenAvailable(otpIpLimiter, ip);
    if (identifier) {
      await consumeWhenAvailable(otpResendLimiter, identifier);
      await consumeWhenAvailable(otpEmailDailyLimiter, identifier);
    }
    next();
  } catch (err) {
    if (err instanceof RateLimiterRes) return next(TooManyRequests(OTP_LIMIT_MESSAGE));
    next();
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
