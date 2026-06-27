import { randomInt } from 'crypto';
import * as argon2 from 'argon2';

export function generateOtp(): string {
  return String(randomInt(100000, 999999));
}

export async function hashOtp(code: string): Promise<string> {
  return argon2.hash(code);
}

export async function verifyOtp(hash: string, code: string): Promise<boolean> {
  return argon2.verify(hash, code);
}
