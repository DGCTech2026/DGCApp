import type { RequestHandler } from 'express';
import { otpResendLimiter, otpEmailDailyLimiter, otpIpLimiter } from '../infra/rateLimit';
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
