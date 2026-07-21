import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface AccessTokenPayload {
  sub: string;
  email?: string; // absent for phone-only accounts
  role: string;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL } as jwt.SignOptions);
}

// jti = the DB row id of the stored token hash, so refresh/logout can look it up O(1)
// instead of scanning every token the user has.
export function signRefreshToken(userId: string, jti: string): string {
  return jwt.sign({ sub: userId, jti }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

// jti is absent on tokens issued before the O(1) lookup existed — callers fall back to a scan.
export function verifyRefreshToken(token: string): { sub: string; jti?: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as { sub: string; jti?: string };
}
