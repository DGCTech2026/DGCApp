import { randomUUID } from 'node:crypto';
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
import { hashValue, verifyHash, sha256, verifyTokenHash } from '../../utils/hash';
import { BadRequest, Unauthorized, Forbidden, Conflict } from '../../utils/errors';

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
// Retry-grace windows for flaky networks: when a client's request succeeds but the response is
// lost in transit, its retry must not dead-end (logged out / forced to request a new code).
const ROTATION_GRACE_MS = 60 * 1000;
const OTP_RETRY_GRACE_S = 90;
const googleClient = new OAuth2Client();

const norm = (s: string) => s.trim().toLowerCase();

type TokenUser = {
  id: string;
  email: string | null;
  globalRole: string;
  suspendedAt?: Date | null;
  deletedAt?: Date | null;
};

// Compact profile embedded in every auth response so the app can render immediately after
// login/refresh without a follow-up GET /users/me — one round trip instead of two, which is
// the difference between "opens" and "hangs" on a slow connection.
const AUTH_USER_SELECT = {
  id: true,
  email: true,
  phoneNumber: true,
  displayName: true,
  avatarUrl: true,
  globalRole: true,
} as const;

// Single chokepoint for token issuance → a suspended or deleted account can't get tokens via ANY
// path (login, OTP, Google, Apple, refresh). This is what gives admin suspend real teeth.
async function issueTokensFor(user: TokenUser) {
  if (user.deletedAt) throw Unauthorized('Account not found');
  if (user.suspendedAt) throw Forbidden('Your account has been suspended');
  const jti = randomUUID(); // becomes the RefreshToken row id → O(1) lookup on refresh/logout
  const refreshToken = signRefreshToken(user.id, jti);
  const accessToken = signAccessToken({
    sub: user.id,
    role: user.globalRole,
    ...(user.email ? { email: user.email } : {}),
  });
  const [, profile] = await Promise.all([
    prisma.refreshToken.create({ data: { id: jti, userId: user.id, hash: sha256(refreshToken) } }),
    prisma.user.findUnique({ where: { id: user.id }, select: AUTH_USER_SELECT }),
  ]);
  return { accessToken, refreshToken, user: profile };
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
//
// Retry grace: after a successful consume, a short-lived marker is kept in Redis. If the client
// never received the response (flaky network) and retries the SAME correct code, the retry is
// honoured instead of dead-ending with "expired" — otherwise every dropped response forces the
// user to request a brand-new code.
async function consumeOtp(identifier: string, code: string, purpose: 'AUTH' | 'RESET') {
  const record = await prisma.otp.findUnique({ where: { identifier } });
  if (!record || record.expiresAt < new Date()) {
    const raw = await redis.get(`otp:grace:${identifier}`);
    if (raw) {
      const grace = JSON.parse(raw) as { hash: string; channel: 'EMAIL' | 'SMS'; purpose: 'AUTH' | 'RESET' };
      if (grace.purpose === purpose && (await verifyOtpHash(grace.hash, code))) {
        return { identifier, channel: grace.channel, purpose: grace.purpose };
      }
    }
    throw BadRequest('OTP expired or not found');
  }
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
  await redis.set(
    `otp:grace:${identifier}`,
    JSON.stringify({ hash: record.hash, channel: record.channel, purpose: record.purpose }),
    'EX',
    OTP_RETRY_GRACE_S,
  );
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
    // The duplicate check and the (CPU-bound) password hash don't depend on each other — overlap them.
    const [existing, passwordHash] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      hashValue(input.password),
    ]);
    if (existing) throw Conflict('An account with this email already exists. Sign in instead.');

    const pending = {
      passwordHash,
      displayName: input.displayName,
      phoneNumber: input.phoneNumber ?? null,
      gender: input.gender ?? null,
      dateOfBirth: input.dateOfBirth ? input.dateOfBirth.toISOString() : null,
      occupation: input.occupation ?? null,
      branchId: input.branchId ?? null,
    };
    const [, code] = await Promise.all([
      redis.set(`register:${email}`, JSON.stringify(pending), 'EX', Math.floor(OTP_TTL_MS / 1000)),
      createOtp(email, 'EMAIL', 'AUTH'),
    ]);
    await emailQueue.add('send-otp', { type: 'otp', to: email, code });
    return { ok: true };
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
    if (!payload.sub) throw Unauthorized('Google token is missing subject');
    const email = norm(payload.email);
    const providerSubject = payload.sub;

    // Prefer matching by Google `sub` first — it's stable across email changes and defends against
    // a user re-verifying via a different sign-in path with the same email. If no Google link
    // exists yet, fall back to email match (existing password/OTP account being linked) or create.
    const existingLink = await prisma.authProvider.findUnique({
      where: { kind_providerSubject: { kind: 'GOOGLE', providerSubject } },
      select: { userId: true },
    });
    let user;
    let isNew: boolean;
    if (existingLink) {
      const existing = await prisma.user.findUnique({
        where: { id: existingLink.userId },
        select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
      });
      if (!existing) throw Unauthorized('Account not found');
      user = existing;
      isNew = false;
    } else {
      const res = await ensureUser(
        { email },
        { email, displayName: payload.name ?? null, avatarUrl: payload.picture ?? null },
      );
      user = res.user;
      isNew = res.isNew;
    }

    // Record/refresh the link. Upsert on (userId, kind): one Google link per user, most-recent
    // subject wins if the Google account is somehow re-issued (very rare but harmless to handle).
    await prisma.authProvider.upsert({
      where: { userId_kind: { userId: user.id, kind: 'GOOGLE' } },
      create: { userId: user.id, kind: 'GOOGLE', providerSubject },
      update: { providerSubject, lastUsedAt: new Date() },
    });

    return { ...(await issueTokensFor(user)), isNewUser: isNew };
  },

  async appleAuth(idToken: string, displayName?: string) {
    if (!env.APPLE_CLIENT_ID) throw BadRequest('Apple sign-in is not configured');
    let claims: { sub?: string; email?: string; email_verified?: string | boolean };
    try {
      claims = await appleSignin.verifyIdToken(idToken, { audience: env.APPLE_CLIENT_ID });
    } catch {
      throw Unauthorized('Invalid Apple token');
    }
    if (!claims.sub) throw Unauthorized('Apple token is missing subject');
    const providerSubject = claims.sub;

    // Apple only returns email on first authorization; on subsequent sign-ins the ID token has
    // no email at all. So we MUST match by `sub` first — that's the only stable identifier every
    // sign-in carries. Fall back to email lookup (or create) only if this is a first-ever Apple
    // sign-in for this user.
    const existingLink = await prisma.authProvider.findUnique({
      where: { kind_providerSubject: { kind: 'APPLE', providerSubject } },
      select: { userId: true },
    });
    let user;
    let isNew: boolean;
    if (existingLink) {
      const existing = await prisma.user.findUnique({
        where: { id: existingLink.userId },
        select: { id: true, email: true, globalRole: true, suspendedAt: true, deletedAt: true },
      });
      if (!existing) throw Unauthorized('Account not found');
      user = existing;
      isNew = false;
    } else {
      // First-time Apple sign-in for this subject → we need the email to provision/link.
      if (!claims.email) throw BadRequest('Apple did not provide an email; cannot create account');
      const email = norm(claims.email);
      const res = await ensureUser({ email }, { email, displayName: displayName ?? null });
      user = res.user;
      isNew = res.isNew;
    }

    await prisma.authProvider.upsert({
      where: { userId_kind: { userId: user.id, kind: 'APPLE' } },
      create: { userId: user.id, kind: 'APPLE', providerSubject },
      update: { providerSubject, lastUsedAt: new Date() },
    });

    return { ...(await issueTokensFor(user)), isNewUser: isNew };
  },

  // What the "Sign-in methods" screen shows: every provider currently linked + whether a password
  // is set. hasPassword tells the client whether the password-change flow is available (vs. the
  // set-password flow). Ordering by createdAt so the UI can show them chronologically.
  async listAuthProviders(userId: string) {
    const [providers, user] = await Promise.all([
      prisma.authProvider.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { kind: true, createdAt: true, lastUsedAt: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, email: true, phoneNumber: true },
      }),
    ]);
    if (!user) throw Unauthorized('Account not found');
    return {
      providers,
      hasPassword: !!user.passwordHash,
      // Surface the fallbacks the client needs to decide whether unlink is destructive.
      hasEmail: !!user.email,
      hasPhone: !!user.phoneNumber,
    };
  },

  // Unlink Google/Apple. Guard against lockout: OTP over email or phone is our always-available
  // fallback, so unlinking a provider is safe as long as the user has at least one of:
  //   - a password set, OR
  //   - a verifiable identifier (email or phone) they can receive OTPs on, OR
  //   - another OAuth link.
  // Every account we provision satisfies at least (email OR phone), so this guard is mostly a
  // safety net — but it's the guarantee we want on paper.
  async unlinkAuthProvider(userId: string, kind: 'GOOGLE' | 'APPLE') {
    const [link, user, otherLinks] = await Promise.all([
      prisma.authProvider.findUnique({
        where: { userId_kind: { userId, kind } },
        select: { id: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true, email: true, phoneNumber: true },
      }),
      prisma.authProvider.count({ where: { userId, kind: { not: kind } } }),
    ]);
    if (!link) throw BadRequest(`${kind} is not linked to this account`);
    if (!user) throw Unauthorized('Account not found');

    const hasFallback = !!user.passwordHash || !!user.email || !!user.phoneNumber || otherLinks > 0;
    if (!hasFallback) {
      throw BadRequest('Cannot unlink your only sign-in method. Set a password first.');
    }

    await prisma.authProvider.delete({ where: { id: link.id } });
    return { ok: true };
  },

  async refreshTokens(rawToken: string) {
    let payload: { sub: string; jti?: string };
    try {
      payload = verifyRefreshToken(rawToken);
    } catch {
      throw Unauthorized('Invalid refresh token');
    }

    // O(1) lookup via jti; scan is the fallback for tokens issued before jti existed.
    let match: { id: string; revokedAt: Date | null } | undefined;
    if (payload.jti) {
      const t = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
      if (t && t.userId === payload.sub && (await verifyTokenHash(t.hash, rawToken))) {
        match = t;
      }
    } else {
      const stored = await prisma.refreshToken.findMany({ where: { userId: payload.sub } });
      for (const t of stored) {
        if (await verifyTokenHash(t.hash, rawToken)) {
          match = t;
          break;
        }
      }
    }
    if (!match) throw Unauthorized('Refresh token revoked');

    // Rotate by marking revoked (not deleting). If the client never received our response and
    // retries with the same token inside the grace window, honour it — otherwise every dropped
    // refresh response logs the user out. Reuse AFTER the window is treated as theft.
    if (match.revokedAt) {
      if (Date.now() - match.revokedAt.getTime() > ROTATION_GRACE_MS) {
        throw Unauthorized('Refresh token revoked');
      }
    } else {
      await prisma.refreshToken.update({ where: { id: match.id }, data: { revokedAt: new Date() } });
    }

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
    await emailQueue.add('send-otp', { type: 'reset-otp', to: id, code });
  },

  // Forgot-password step 1.5: verify the RESET code is correct without consuming it.
  // Returns { ok: true } so the frontend can show the "enter new password" screen.
  async verifyResetOtp(email: string, code: string) {
    const id = norm(email);
    const record = await prisma.otp.findUnique({ where: { identifier: id } });
    if (!record || record.expiresAt < new Date()) throw BadRequest('OTP expired or not found');
    if (record.purpose !== 'RESET') throw BadRequest('This code was not issued for a password reset');
    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await prisma.otp.delete({ where: { identifier: id } });
      throw BadRequest('Too many attempts. Request a new code.');
    }
    const valid = await verifyOtpHash(record.hash, code);
    if (!valid) {
      await prisma.otp.update({ where: { identifier: id }, data: { attempts: { increment: 1 } } });
      throw BadRequest('Invalid OTP');
    }
    return { ok: true };
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
    // O(1) via jti when present; scan fallback for pre-jti tokens.
    try {
      const payload = verifyRefreshToken(rawToken);
      if (payload.jti) {
        const t = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
        if (t && t.userId === userId && (await verifyTokenHash(t.hash, rawToken))) {
          await prisma.refreshToken.delete({ where: { id: t.id } });
        }
        return;
      }
    } catch {
      return; // invalid/expired token — nothing to revoke
    }
    const stored = await prisma.refreshToken.findMany({ where: { userId } });
    for (const t of stored) {
      if (await verifyTokenHash(t.hash, rawToken)) {
        await prisma.refreshToken.delete({ where: { id: t.id } });
        return;
      }
    }
  },
};
