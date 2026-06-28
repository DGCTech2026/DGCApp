import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from './redis';

// Redis-backed OTP rate limits (CLAUDE.md §9). One Redis, keyed by purpose.

// Resend cooldown: at most 1 OTP request per email per 60s.
export const otpResendLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'otp_resend',
  points: 1,
  duration: 60,
});

// Per-email daily cap.
export const otpEmailDailyLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'otp_email_day',
  points: 10,
  duration: 60 * 60 * 24,
});

// Per-IP hourly cap (blunt abuse guard).
export const otpIpLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'otp_ip',
  points: 30,
  duration: 60 * 60,
});

// Password login brute-force guards.
export const loginEmailLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'login_email',
  points: 10,
  duration: 60 * 15,
});
export const loginIpLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'login_ip',
  points: 50,
  duration: 60 * 15,
});
