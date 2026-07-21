import { randomInt, createHmac, timingSafeEqual } from 'node:crypto';
import * as argon2 from 'argon2';
import { env } from '../config/env';

// OTP codes are hashed with keyed HMAC-SHA256 instead of argon2: the key is derived from a
// server secret that never touches the DB, so a DB leak alone cannot brute-force the 6-digit
// space, and online guessing is already capped at 5 attempts. argon2 here cost ~400ms on every
// request-otp AND every verify for no additional protection.
const OTP_KEY = createHmac('sha256', env.JWT_REFRESH_SECRET).update('otp-hmac-key').digest();

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export async function hashOtp(code: string): Promise<string> {
  return createHmac('sha256', OTP_KEY).update(code).digest('hex');
}

// argon2 fallback covers codes issued before the HMAC switch (10-minute OTP lifetime).
export async function verifyOtp(hash: string, code: string): Promise<boolean> {
  if (hash.startsWith('$argon2')) return argon2.verify(hash, code).catch(() => false);
  const a = Buffer.from(hash, 'hex');
  const b = createHmac('sha256', OTP_KEY).update(code).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
