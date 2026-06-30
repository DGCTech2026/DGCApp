import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import appleSignin from 'apple-signin-auth';
import { prisma } from '../../infra/db';
import { emailQueue, smsQueue } from '../../infra/queue';
import { env } from '../../config/env';
import { isSmsConfigured } from '../../infra/sms';
import { redis } from '../../infra/redis';
import { growthEngine } from '../growth/growth.engine';
import { onboardToBranch } from '../users/users.service';
import { isDisposableEmail } from '../../utils/email';
import type { RegisterInput } from './auth.schema';
import { generateOtp, hashOtp, verifyOtp as verifyOtpHash } from '../../utils/otp';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt';
import { hashValue, verifyHash } from '../../utils/hash';
import { BadRequest, Unauthorized, Forbidden, Conflict } from '../../utils/errors';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const googleClient = new OAuth2Client();

const norm = (s: string) => s.trim().toLowerCase();

type TokenUser = {
  id: string;
  email: string | null;
  globalRole: string;
  suspendedAt?: Date | null;
  deletedAt?: Date | null;
};

// Single chokepoint for token issuance → a suspended or deleted account can't get tokens via ANY
// path (login, OTP, Google, Apple, refresh). This is what gives admin suspend real teeth.
async function issueTokensFor(user: TokenUser) {
  if (user.deletedAt) throw Unauthorized('Account not found');
  if (user.suspendedAt) throw Forbidden('Your account has been suspended');
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
// Returns `isNew` so the auth response can tell the client whether to route into onboarding.
async function ensureUser(
  where: { email: string } | { phoneNumber: string },
  create: { email?: string; phoneNumber?: string; displayName?: string | null; avatarUrl?: string | null },
): Promise<{ user: TokenUser; isNew: boolean }> {
  const existing = await prisma.user.findUnique({
    where,
    select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
  });
  if (existing) return { user: existing, isNew: false };

  const firstTimer = await prisma.growthStage.findUnique({ where: { key: 'FIRST_TIMER' } });
  try {
    const user = await prisma.user.create({
      data: { ...create, ...(firstTimer ? { currentStageId: firstTimer.id } : {}) },
      select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
    });
    await growthEngine.enqueueRequirement(user.id, 'CREATE_ACCOUNT'); // AUTO (First Timer, §11)
    return { user, isNew: true };
  } catch {
    // Race: created between our check and create — fetch and treat as existing.
    const user = await prisma.user.findUniqueOrThrow({
      where,
      select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
    });
    return { user, isNew: false };
  }
}

async function createOtp(
  identifier: string,
  channel: 'EMAIL' | 'SMS',
  purpose: 'AUTH' | 'RESET',
): Promise<string> {
  const code = generateOtp();
  const hash = await hashOtp(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  await prisma.otp.upsert({
    where: { identifier },
    create: { identifier, channel, purpose, hash, expiresAt, attempts: 0 },
    update: { channel, purpose, hash, expiresAt, attempts: 0 }, // new code resets attempt counter
  });
  return code;
}

// Validate + consume a one-time code (single-use, attempt cap, purpose-bound). Returns the consumed
// record so the caller can read its channel. Throws on any failure.
async function consumeOtp(identifier: string, code: string, purpose: 'AUTH' | 'RESET') {
  const record = await prisma.otp.findUnique({ where: { identifier } });
  if (!record || record.expiresAt < new Date()) throw BadRequest('OTP expired or not found');
  if (record.purpose !== purpose) {
    throw BadRequest('This code was not issued for this action. Please request a new one.');
  }
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.otp.delete({ where: { identifier } });
    throw BadRequest('Too many attempts. Request a new code.');
  }
  const valid = await verifyOtpHash(record.hash, code);
  if (!valid) {
    await prisma.otp.update({ where: { identifier }, data: { attempts: { increment: 1 } } });
    throw BadRequest('Invalid OTP');
  }
  await prisma.otp.delete({ where: { identifier } });
  return record;
}

export const authService = {
  // Single-submit registration: stash the Create Account form + email a code. The account is
  // created (fully populated + branch-onboarded) only when the code is verified.
  async register(input: RegisterInput) {
    const email = norm(input.email);
    if (isDisposableEmail(email)) {
      throw BadRequest('Please use a permanent email address — disposable email providers are not allowed.');
    }
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw Conflict('An account with this email already exists. Sign in instead.');

    const pending = {
      passwordHash: await hashValue(input.password),
      displayName: input.displayName,
      phoneNumber: input.phoneNumber ?? null,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirth ? input.dateOfBirth.toISOString() : null,
      occupation: input.occupation ?? null,
      branchId: input.branchId ?? null,
    };
    await redis.set(`register:${email}`, JSON.stringify(pending), 'EX', Math.floor(OTP_TTL_MS / 1000));

    const code = await createOtp(email, 'EMAIL', 'AUTH');
    await emailQueue.add('send-otp', { type: 'otp', to: email, code });
    return { ok: true };
  },

  // Back-compat alias — /auth/register/verify now funnels into the unified verifyOtp below.
  async registerVerify(email: string, code: string) {
    return this.verifyOtp(email, code);
  },

  async requestEmailOtp(email: string) {
    const id = norm(email);
    if (isDisposableEmail(id)) {
      throw BadRequest('Please use a permanent email address — disposable email providers are not allowed.');
    }
    const code = await createOtp(id, 'EMAIL', 'AUTH');
    await emailQueue.add('send-otp', { type: 'otp', to: id, code });
  },

  async requestPhoneOtp(phone: string) {
    if (!isSmsConfigured()) throw BadRequest('Phone sign-in is not configured');
    const id = norm(phone);
    const code = await createOtp(id, 'SMS', 'AUTH');
    await smsQueue.add('send-otp', { to: id, code });
  },

  // Unified OTP verification (email or phone). If a registration is pending for this identifier,
  // finish the full, branch-onboarded account from the stashed form; otherwise passwordless
  // sign-in (create-or-login). The same emailed/texted code works either way, so the client can't
  // pick the "wrong" verify endpoint. The OTP's channel decides which identity to use on sign-in.
  async verifyOtp(identifier: string, code: string) {
    const id = norm(identifier);
    const record = await consumeOtp(id, code, 'AUTH');

    const raw = await redis.get(`register:${id}`);
    if (raw) {
      await redis.del(`register:${id}`);
      const pending = JSON.parse(raw) as {
        passwordHash: string;
        displayName: string;
        phoneNumber: string | null;
        gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
        dateOfBirth: string | null;
        occupation: string | null;
        branchId: string | null;
      };
      const firstTimer = await prisma.growthStage.findUnique({ where: { key: 'FIRST_TIMER' } });
      let user: TokenUser;
      try {
        user = await prisma.user.create({
          data: {
            email: id,
            passwordHash: pending.passwordHash,
            displayName: pending.displayName,
            phoneNumber: pending.phoneNumber,
            gender: pending.gender ?? undefined,
            dateOfBirth: pending.dateOfBirth ? new Date(pending.dateOfBirth) : null,
            occupation: pending.occupation,
            ...(firstTimer ? { currentStageId: firstTimer.id } : {}),
          },
          select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
        });
      } catch {
        throw Conflict('That email or phone number is already in use');
      }
      await growthEngine.enqueueRequirement(user.id, 'CREATE_ACCOUNT'); // AUTO (§11)
      if (pending.branchId) await onboardToBranch(user.id, pending.branchId);
      return { ...(await issueTokensFor(user)), isNewUser: true };
    }

    const { user, isNew } =
      record.channel === 'EMAIL'
        ? await ensureUser({ email: id }, { email: id })
        : await ensureUser({ phoneNumber: id }, { phoneNumber: id });
    return { ...(await issueTokensFor(user)), isNewUser: isNew };
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
    const email = norm(payload.email);
    // Google gives us name + picture — pre-fill them on first signup (don't clobber an existing profile).
    const { user, isNew } = await ensureUser(
      { email },
      { email, displayName: payload.name ?? null, avatarUrl: payload.picture ?? null },
    );
    return { ...(await issueTokensFor(user)), isNewUser: isNew };
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
    // (Apple sends the display name only in the initial client authorization payload, not the ID token.)
    if (!claims.email) throw BadRequest('Apple did not provide an email; cannot create account');
    const email = norm(claims.email);
    const { user, isNew } = await ensureUser({ email }, { email });
    return { ...(await issueTokensFor(user)), isNewUser: isNew };
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
      select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
    });
    return issueTokensFor(user);
  },

  async login(email: string, password: string) {
    const id = norm(email);
    const user = await prisma.user.findUnique({
      where: { email: id },
      select: { id: true, email: true, globalRole: true, passwordHash: true, suspendedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw Unauthorized('Invalid email or password');
    if (!user.passwordHash) {
      throw BadRequest('No password set for this account. Sign in with a code or Google/Apple, or set a password.');
    }
    const ok = await verifyHash(user.passwordHash, password).catch(() => false);
    if (!ok) throw Unauthorized('Invalid email or password');
    return issueTokensFor(user); // also enforces suspended/deleted
  },

  // Set or change the authenticated user's password. Changing an existing password requires the
  // current one; first-time set (OTP/Google accounts with no password) does not.
  async setPassword(userId: string, password: string, currentPassword?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw Unauthorized();
    if (user.passwordHash) {
      if (!currentPassword) throw BadRequest('Current password is required to change your password');
      const ok = await verifyHash(user.passwordHash, currentPassword).catch(() => false);
      if (!ok) throw BadRequest('Current password is incorrect');
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashValue(password) } });
    return { ok: true };
  },

  // Forgot-password step 1: email a RESET-purpose code. Always returns ok to the client, but only
  // actually sends when the account exists — so it can't be used to enumerate registered emails.
  async requestPasswordResetOtp(email: string) {
    const id = norm(email);
    const user = await prisma.user.findUnique({ where: { email: id }, select: { id: true } });
    if (!user) return;
    const code = await createOtp(id, 'EMAIL', 'RESET');
    await emailQueue.add('send-otp', { type: 'otp', to: id, code });
  },

  // Forgot-password step 2: RESET-purpose code + new password. A login/registration code is
  // rejected here (wrong purpose), so it can't be replayed to take over an account.
  async resetPassword(email: string, code: string, newPassword: string) {
    const id = norm(email);
    await consumeOtp(id, code, 'RESET');

    const user = await prisma.user.findUnique({
      where: { email: id },
      select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
    });
    if (!user) throw BadRequest('No account found for this email');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashValue(newPassword) } });
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
