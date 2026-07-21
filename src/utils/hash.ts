import * as argon2 from 'argon2';
import { createHash, timingSafeEqual } from 'node:crypto';

// OWASP-recommended interactive params (argon2id, 19MB, t=2, p=1) — ~75ms vs ~390ms for the
// library defaults, whose 64MB-per-hash also let a few concurrent signups exhaust a small
// instance's memory. Old hashes still verify: params are embedded in the hash string.
const ARGON2_OPTS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashValue(value: string): Promise<string> {
  return argon2.hash(value, ARGON2_OPTS);
}

export async function verifyHash(hash: string, value: string): Promise<boolean> {
  return argon2.verify(hash, value);
}

// Storage hash for refresh tokens. They are high-entropy signed JWTs — offline brute force is
// impossible — so a fast digest is the correct choice; argon2 here only added ~400ms to every
// login/refresh and protected nothing.
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Verify a stored refresh-token hash: SHA-256 for new rows, argon2 fallback for rows written
// before the switch (30-day refresh lifetime, so the fallback stays until those age out).
export async function verifyTokenHash(stored: string, raw: string): Promise<boolean> {
  if (stored.startsWith('$argon2')) return argon2.verify(stored, raw).catch(() => false);
  const a = Buffer.from(stored, 'hex');
  const b = createHash('sha256').update(raw).digest();
  return a.length === b.length && timingSafeEqual(a, b);
}
