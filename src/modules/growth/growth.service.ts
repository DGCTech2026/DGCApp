import { prisma } from '../../infra/db';
import { growthEngine } from './growth.engine';
import { NotFound, BadRequest } from '../../utils/errors';

export const growthService = {
  // "My Journey": current stage, progress %, next action, the full pipeline, current-stage
  // requirements with completion flags, and earned badges.
  async getMySummary(userId: string) {
    const [user, stages, completions, userBadges] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { currentStageId: true } }),
      prisma.growthStage.findMany({ orderBy: { order: 'asc' }, select: { id: true, key: true, name: true, order: true } }),
      prisma.requirementCompletion.findMany({ where: { userId }, select: { requirementId: true } }),
      prisma.userBadge.findMany({
        where: { userId },
        orderBy: { awardedAt: 'desc' },
        select: { awardedAt: true, badge: { select: { key: true, name: true, icon: true } } },
      }),
    ]);

    const current = stages.find((s) => s.id === user.currentStageId) ?? stages[0];
    const currentOrder = current?.order ?? 1;
    const total = stages.length || 1;

    const currentReqs = current
      ? await prisma.growthRequirement.findMany({
          where: { stageId: current.id },
          orderBy: { key: 'asc' },
          select: { id: true, key: true, label: true, type: true },
        })
      : [];
    const doneSet = new Set(completions.map((c) => c.requirementId));
    const requirements = currentReqs.map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type,
      completed: doneSet.has(r.id),
    }));

    const nextStage = stages.find((s) => s.order === currentOrder + 1) ?? null;
    const nextIncomplete = requirements.find((r) => !r.completed);

    return {
      currentStage: current ? { key: current.key, name: current.name, order: current.order } : null,
      progressPercent: Math.round((currentOrder / total) * 100),
      nextStage: nextStage ? { key: nextStage.key, name: nextStage.name, order: nextStage.order } : null,
      nextAction:
        nextIncomplete?.label ?? (nextStage ? `Advance to ${nextStage.name}` : 'You have reached the final stage'),
      stages: stages.map((s) => ({
        key: s.key,
        name: s.name,
        order: s.order,
        reached: s.order <= currentOrder,
        isCurrent: s.id === current?.id,
      })),
      currentStageRequirements: requirements,
      badges: userBadges.map((ub) => ({ ...ub.badge, awardedAt: ub.awardedAt })),
    };
  },

  // Member marks a SELF_ATTEST requirement done (e.g. "Watch Welcome Video").
  async selfAttest(userId: string, requirementKey: string) {
    const req = await prisma.growthRequirement.findUnique({
      where: { key: requirementKey },
      select: { id: true, type: true },
    });
    if (!req) throw NotFound('Requirement not found');
    if (req.type !== 'SELF_ATTEST') throw BadRequest('This requirement cannot be self-attested');
    await growthEngine.completeRequirementById(userId, req.id, 'SELF_ATTEST');
    return this.getMySummary(userId);
  },

  async submitCertificate(userId: string, input: { requirementKey: string; title: string; fileUrl: string }) {
    const req = await prisma.growthRequirement.findUnique({
      where: { key: input.requirementKey },
      select: { id: true, type: true },
    });
    if (!req) throw NotFound('Requirement not found');
    if (req.type !== 'CERTIFICATE') throw BadRequest('This requirement does not accept a certificate');
    return prisma.certificate.create({
      data: { userId, requirementId: req.id, title: input.title, fileUrl: input.fileUrl, status: 'PENDING' },
      select: { id: true, title: true, fileUrl: true, status: true, submittedAt: true, requirementId: true },
    });
  },

  async listMyCertificates(userId: string) {
    return prisma.certificate.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        status: true,
        submittedAt: true,
        verifiedAt: true,
        rejectionReason: true,
        requirement: { select: { key: true, label: true } },
      },
    });
  },

  // ---- admin: certificate verification queue (PRD §13) ----
  async listPendingCertificates() {
    return prisma.certificate.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        title: true,
        fileUrl: true,
        submittedAt: true,
        user: { select: { id: true, displayName: true, email: true } },
        requirement: { select: { key: true, label: true } },
      },
    });
  },

  async verifyCertificate(adminId: string, certId: string) {
    const cert = await prisma.certificate.findUnique({
      where: { id: certId },
      select: { status: true, userId: true, requirementId: true },
    });
    if (!cert) throw NotFound('Certificate not found');
    if (cert.status !== 'PENDING') throw BadRequest('Certificate already processed');
    await prisma.certificate.update({
      where: { id: certId },
      data: { status: 'VERIFIED', verifiedById: adminId, verifiedAt: new Date() },
    });
    if (cert.requirementId) {
      await growthEngine.completeRequirementById(cert.userId, cert.requirementId, 'CERTIFICATE', adminId);
    }
    return { ok: true };
  },

  async rejectCertificate(adminId: string, certId: string, reason?: string) {
    const cert = await prisma.certificate.findUnique({ where: { id: certId }, select: { status: true } });
    if (!cert) throw NotFound('Certificate not found');
    if (cert.status !== 'PENDING') throw BadRequest('Certificate already processed');
    await prisma.certificate.update({
      where: { id: certId },
      data: { status: 'REJECTED', verifiedById: adminId, verifiedAt: new Date(), rejectionReason: reason ?? null },
    });
    return { ok: true };
  },

  async adminVerifyRequirement(adminId: string, userId: string, requirementKey: string) {
    const req = await prisma.growthRequirement.findUnique({
      where: { key: requirementKey },
      select: { id: true, type: true },
    });
    if (!req) throw NotFound('Requirement not found');
    if (req.type !== 'ADMIN_VERIFY') throw BadRequest('This requirement is not admin-verifiable');
    await growthEngine.completeRequirementById(userId, req.id, 'ADMIN_VERIFY', adminId);
    return { ok: true };
  },
};
