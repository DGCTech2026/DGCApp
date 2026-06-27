import type { RequestHandler } from 'express';
import { otpResendLimiter, otpEmailDailyLimiter, otpIpLimiter } from '../infra/rateLimit';
import { TooManyRequests } from '../utils/errors';

// Guards OTP request: per-IP hourly, per-email resend cooldown + daily cap.
// Mount AFTER `validate(requestOtpSchema)` so req.body.email is present and valid.
export const otpRequestRateLimit: RequestHandler = async (req, _res, next) => {
  const email = String(req.body?.email ?? '').toLowerCase();
  const ip = req.ip ?? 'unknown';
  try {
    await otpIpLimiter.consume(ip);
    if (email) {
      await otpResendLimiter.consume(email);
      await otpEmailDailyLimiter.consume(email);
    }
    next();
  } catch {
    next(TooManyRequests('Too many OTP requests. Please wait and try again.'));
  }
};
