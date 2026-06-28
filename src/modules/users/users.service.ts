import { prisma } from '../../infra/db';
import { NotFound, BadRequest, Conflict } from '../../utils/errors';
import { growthEngine } from '../growth/growth.engine';
import type { UpdateMeInput } from './users.schema';

const ME_SELECT = {
  id: true,
  email: true,
  phoneNumber: true,
  globalRole: true,
  displayName: true,
  avatarUrl: true,
  gender: true,
  dateOfBirth: true,
  occupation: true,
  bio: true,
  createdAt: true,
} as const;

// PRD §2: selecting a branch auto-joins the branch community + Global Announcement channel.
// Exported so registration (auth.service) can reuse the exact same onboarding.
export async function onboardToBranch(userId: string, branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) throw BadRequest('Branch not found');

  const memberships = await prisma.branchMembership.findMany({ where: { userId }, select: { branchId: true } });
  if (memberships.some((m) => m.branchId === branchId)) return; // idempotent — already in this branch
  if (memberships.length > 0) {
    throw Conflict('Already assigned to a branch; an admin must move you between branches');
  }

  const branchChannels = await prisma.channel.findMany({ where: { branchId }, select: { id: true } });
  const globalChannel = await prisma.channel.findFirst({
    where: { type: 'GLOBAL_ANNOUNCEMENT' },
    select: { id: true },
  });
  const channelIds = [...branchChannels.map((c) => c.id), ...(globalChannel ? [globalChannel.id] : [])];

  // Two statements (membership + a single createMany), not N round-trips — stays well under the
  // transaction timeout even against a remote DB. skipDuplicates keeps it idempotent.
  await prisma.$transaction(
    async (tx) => {
      await tx.branchMembership.create({ data: { userId, branchId, role: 'MEMBER' } });
      await tx.channelMembership.createMany({
        data: channelIds.map((channelId) => ({ userId, channelId })),
        skipDuplicates: true,
      });
    },
    { timeout: 20000, maxWait: 10000 },
  );
  await growthEngine.enqueueRequirement(userId, 'JOIN_BRANCH'); // AUTO (First Timer, §11)
}

export const userService = {
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...ME_SELECT,
        currentStage: { select: { key: true, name: true, order: true } },
        branchMemberships: {
          select: { role: true, branch: { select: { id: true, name: true, city: true } } },
        },
        clusterMemberships: {
          select: { role: true, cluster: { select: { id: true, name: true, slug: true } } },
        },
      },
    });
    if (!user) throw NotFound('User not found');
    // The client uses this to decide whether to route into the Create Account onboarding screens.
    return {
      ...user,
      onboardingComplete: Boolean(user.displayName && user.branchMemberships.length > 0),
    };
  },

  async updateMe(userId: string, data: UpdateMeInput) {
    const { branchId, email, phoneNumber, ...profile } = data;
    const updates: Record<string, unknown> = { ...profile };

    // Contact additions: fill in the channel the user didn't sign up with. Only settable when
    // empty (changing a verified identity needs re-verification — a later slice), and unique.
    if (email !== undefined || phoneNumber !== undefined) {
      const current = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, phoneNumber: true },
      });
      if (email !== undefined) {
        const e = email.toLowerCase();
        if (current.email && current.email !== e) throw Conflict('Email is already set on this account');
        if (!current.email) {
          const taken = await prisma.user.findUnique({ where: { email: e }, select: { id: true } });
          if (taken && taken.id !== userId) throw Conflict('That email is already in use');
          updates.email = e;
        }
      }
      if (phoneNumber !== undefined) {
        if (current.phoneNumber && current.phoneNumber !== phoneNumber) {
          throw Conflict('Phone number is already set on this account');
        }
        if (!current.phoneNumber) {
          const taken = await prisma.user.findUnique({ where: { phoneNumber }, select: { id: true } });
          if (taken && taken.id !== userId) throw Conflict('That phone number is already in use');
          updates.phoneNumber = phoneNumber;
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updates });
    }
    if (branchId) await onboardToBranch(userId, branchId);
    return this.getMe(userId);
  },

  // Self-delete (hard purge) — removes the account + its data and frees the email/phone for reuse.
  // Handy for testing; also a legit "delete my account" action.
  async deleteMe(userId: string) {
    await prisma.$transaction(
      async (tx) => {
        await tx.message.deleteMany({ where: { senderId: userId } }); // Message.senderId is RESTRICT
        await tx.user.delete({ where: { id: userId } }); // cascades memberships, growth, badges, certs, tokens, etc.
      },
      { timeout: 20000, maxWait: 10000 },
    );
    return { ok: true };
  },
};
