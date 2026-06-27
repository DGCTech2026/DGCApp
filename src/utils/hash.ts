import * as argon2 from 'argon2';

export async function hashValue(value: string): Promise<string> {
  return argon2.hash(value);
}

export async function verifyHash(hash: string, value: string): Promise<boolean> {
  return argon2.verify(hash, value);
}
