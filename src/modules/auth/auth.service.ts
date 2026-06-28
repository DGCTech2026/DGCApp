import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { prisma } from '../../infra/db';
import { emailQueue, smsQueue } from '../../infra/queue';
import { env } from '../../config/env';
import { isSmsConfigured } from '../../infra/sms';
import { generateOtp, hashOtp, verifyOtp as verifyOtpHash } from '../../utils/otp';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { hashValue, verifyHash } from '../../utils/hash';
import { BadRequest, Unauthorized } from '../../utils/errors';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const googleClient = new OAuth2Client();

const norm = (s: string) => s.trim().toLowerCase();

type TokenUser = { id: string; email: string | null; globalRole: string };

async function issueTokensFor(user: TokenUser) {
  const refreshToken = signRefreshToken(user.id);
  await prisma.refreshToken.create({ data: { userId: user.id, hash: await hashValue(refreshToken) } });
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.globalRole,
    ...(user.email ? { email: user.email } : {}),
  });
  return { accessToken, refreshToken };
}

// Every account starts at the First Timer growth stage (PRD §11 Stage 1).
async function ensureUser(
  where: { email: string } | { phoneNumber: string },
  create: { email?: string; phoneNumber?: string },
): Promise<TokenUser> {
  const firstTimer = await prisma.growthStage.findUnique({ where: { key: 'FIRST_TIMER' } });
  return prisma.user.upsert({
    where,
    create: { ...create, ...(firstTimer ? { currentStageId: firstTimer.id } : {}) },
    update: {},
    select: { id: true, email: true, globalRole: true },
  });
}

async function createOtp(identifier: string, channel: 'EMAIL' | 'SMS'): Promise<string> {
  const code = generateOtp();
  const hash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.otp.upsert({
    where: { identifier },
    create: { identifier, channel, hash, expiresAt, attempts: 0 },
    update: { channel, hash, expiresAt, attempts: 0 }, // new code resets attempt counter
  });
  return code;
}

export const authService = {
  async requestEmailOtp(email: string) {
    const id = norm(email);
    const code = await createOtp(id, 'EMAIL');
    await emailQueue.add('send-otp', { type: 'otp', to: id, code });
  },

  async requestPhoneOtp(phone: string) {
    if (!isSmsConfigured()) throw BadRequest('Phone sign-in is not configured');
    const id = norm(phone);
    const code = await createOtp(id, 'SMS');
    await smsQueue.add('send-otp', { to: id, code });
  },

  // Shared by email + phone verify — the stored OTP's channel decides which identity to upsert.
  async verifyOtp(identifier: string, code: string) {
    const id = norm(identifier);
    const record = await prisma.otp.findUnique({ where: { identifier: id } });
    if (!record || record.expiresAt < new Date()) throw BadRequest('OTP expired or not found');

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.otp.delete({ where: { identifier: id } });
      throw BadRequest('Too many attempts. Request a new code.');
    }

    const valid = await verifyOtpHash(record.hash, code);
    if (!valid) {
      await prisma.otp.update({ where: { identifier: id }, data: { attempts: { increment: 1 } } });
      throw BadRequest('Invalid OTP');
    }

    await prisma.otp.delete({ where: { identifier: id } }); // single-use

    const user =
      record.channel === 'EMAIL'
        ? await ensureUser({ email: id }, { email: id })
        : await ensureUser({ phoneNumber: id }, { phoneNumber: id });

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
    const user = await ensureUser({ email: norm(payload.email) }, { email: norm(payload.email) });
    return issueTokensFor(user);
  },

  async appleAuth(idToken: string) {
    if (!env.APPLE_CLIENT_ID) throw BadRequest('Apple sign-in is not configured');
    let claims: { email?: string; email_verified?: string | boolean };
    try {
      claims = await appleSignin.verifyIdToken(idToken, { audience: env.APPLE_CLIENT_ID });
    } catch {
      throw Unauthorized('Invalid Apple token');
    }
    // Apple only returns email on first authorization; require it to provision the account.
    if (!claims.email) throw BadRequest('Apple did not provide an email; cannot create account');
    const user = await ensureUser({ email: norm(claims.email) }, { email: norm(claims.email) });
    return issueTokensFor(user);
  },

  async refreshTokens(rawToken: string) {
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(rawToken);
    } catch {
      throw Unauthorized('Invalid refresh token');
    }

    const stored = await prisma.refreshToken.findMany({ where: { userId: payload.sub } });
    let match: (typeof stored)[number] | undefined;
    for (const t of stored) {
      if (await verifyHash(t.hash, rawToken).catch(() => false)) {
        match = t;
        break;
      }
    }
    if (!match) throw Unauthorized('Refresh token revoked');

    await prisma.refreshToken.delete({ where: { id: match.id } }); // rotate

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: payload.sub },
      select: { id: true, email: true, globalRole: true },
    });
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
