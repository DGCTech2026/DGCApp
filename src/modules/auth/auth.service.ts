import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { prisma } from '../../infra/db';
import { emailQueue } from '../../infra/queue';
import { env } from '../../config/env';
import { generateOtp, hashOtp, verifyOtp } from '../../utils/otp';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { hashValue, verifyHash } from '../../utils/hash';
import { BadRequest, Unauthorized } from '../../utils/errors';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const googleClient = new OAuth2Client();

type TokenUser = { id: string; email: string; globalRole: string };

async function issueTokensFor(user: TokenUser) {
  const refreshToken = signRefreshToken(user.id);
  const hashedRefresh = await hashValue(refreshToken);
  await prisma.refreshToken.create({ data: { userId: user.id, hash: hashedRefresh } });
  return {
    accessToken: signAccessToken({ sub: user.id, email: user.email, role: user.globalRole }),
    refreshToken,
  };
}

export const authService = {
  async requestOtp(email: string) {
    const normalized = email.toLowerCase();
    const code = generateOtp();
    const hashed = await hashOtp(code);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    // New code resets the attempt counter.
    await prisma.otp.upsert({
      where: { email: normalized },
      create: { email: normalized, hash: hashed, expiresAt, attempts: 0 },
      update: { hash: hashed, expiresAt, attempts: 0 },
    });

    // Delivery is offloaded to the email worker (never block the request — CLAUDE.md §4).
    await emailQueue.add('send-otp', { type: 'otp', to: normalized, code });
  },

  async verifyOtp(email: string, code: string) {
    const normalized = email.toLowerCase();
    const record = await prisma.otp.findUnique({ where: { email: normalized } });
    if (!record || record.expiresAt < new Date()) throw BadRequest('OTP expired or not found');

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.otp.delete({ where: { email: normalized } });
      throw BadRequest('Too many attempts. Request a new code.');
    }

    const valid = await verifyOtp(record.hash, code);
    if (!valid) {
      await prisma.otp.update({ where: { email: normalized }, data: { attempts: { increment: 1 } } });
      throw BadRequest('Invalid OTP');
    }

    // Single-use: consume on success.
    await prisma.otp.delete({ where: { email: normalized } });

    const user = await prisma.user.upsert({
      where: { email: normalized },
      create: { email: normalized },
      update: {},
    });

    return issueTokensFor(user);
  },

  async googleAuth(idToken: string) {
    if (!env.GOOGLE_CLIENT_ID) throw BadRequest('Google sign-in is not configured');

    let payload: TokenPayload | undefined;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw Unauthorized('Invalid Google token');
    }
    if (!payload?.email || !payload.email_verified) throw Unauthorized('Google account email not verified');

    const normalized = payload.email.toLowerCase();
    const user = await prisma.user.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        displayName: payload.name ?? null,
        avatarUrl: payload.picture ?? null,
      },
      update: {},
    });

    return issueTokensFor(user);
  },

  async refreshTokens(rawToken: string) {
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(rawToken);
    } catch {
      throw Unauthorized('Invalid refresh token');
    }

    // Find the stored hash that matches this token (rotation: one row per issued token).
    const stored = await prisma.refreshToken.findMany({ where: { userId: payload.sub } });
    let match: (typeof stored)[number] | undefined;
    for (const t of stored) {
      if (await verifyHash(t.hash, rawToken).catch(() => false)) {
        match = t;
        break;
      }
    }
    if (!match) throw Unauthorized('Refresh token revoked');

    // Rotate: invalidate the used token, issue a fresh pair.
    await prisma.refreshToken.delete({ where: { id: match.id } });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return issueTokensFor(user);
  },

  async logout(userId: string, rawToken: string) {
    const stored = await prisma.refreshToken.findMany({ where: { userId } });
    for (const t of stored) {
      if (await verifyHash(t.hash, rawToken).catch(() => false)) {
        await prisma.refreshToken.delete({ where: { id: t.id } });
        return;
      }
    }
  },
};
