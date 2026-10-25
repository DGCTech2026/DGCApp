import { prisma } from '../../infra/db';
import { growthQueue } from '../../infra/queue';
import { enqueue } from '../../infra/enqueue';
import { notificationService } from '../notifications/notifications.service';
import { logger } from '../../infra/logger';
import { placeMember } from './place';

type RequirementSource = 'AUTO' | 'SELF_ATTEST' | 'ADMIN_VERIFY' | 'CERTIFICATE' | 'URL_UPLOAD';
type CompleteOpts = { verifiedById?: string; fileUrl?: string };

// The growth state machine (CLAUDE.md §6.2). All transition logic lives here, in one place.
export const growthEngine = {
  // AUTO requirements fire off the request path — enqueue, the worker records + recomputes.
  // Fire-and-forget: a growth stage bump is a side-effect of the user's primary action; a
  // Redis blip must not fail the caller's write. Worker retries handle transient failures.
  enqueueRequirement(userId: string, requirementKey: string) {
    enqueue(growthQueue, 'complete-requirement', { userId, requirementKey });
  },

  async completeRequirement(
    userId: string,
    requirementKey: string,
    source: RequirementSource,
    opts: CompleteOpts = {},
  ) {
    const requirement = await prisma.growthRequirement.findUnique({
      where: { key: requirementKey },
      select: { id: true },
    });
    if (!requirement) {
      logger.warn({ requirementKey }, 'completeRequirement: unknown requirement key');
      return;
    }
    await this.completeRequirementById(userId, requirement.id, source, opts);
  },

  async completeRequirementById(
    userId: string,
    requirementId: string,
    source: RequirementSource,
    opts: CompleteOpts = {},
  ) {
    await prisma.requirementCompletion.upsert({
      where: { userId_requirementId: { userId, requirementId } },
      create: {
        userId,
        requirementId,
        source,
        verifiedById: opts.verifiedById ?? null,
        fileUrl: opts.fileUrl ?? null,
      },
      // If the user re-uploads a URL_UPLOAD proof (fixed a bad photo), refresh the fileUrl so
      // the audit trail shows the latest submitted file. Everything else stays fixed.
      update: opts.fileUrl ? { fileUrl: opts.fileUrl } : {},
    });
    await this.recompute(userId);
  },

  // Derive the current stage from completed requirements, advance, award badges, notify on advance.
  // Idempotent: always recomputes from the full completion set, so retries/duplicates are safe.
  // notify defaults to true. The pipeline sync script does not call this path, so a backfill
  // cannot push the membership or open a Redis connection.
  async recompute(userId: string, opts?: { notify?: boolean }) {
    const notice = await placeMember(prisma, userId);
    if (!notice || opts?.notify === false) return;
    // notificationService.notify handles both the in-app row (socket + DB) and FCM push in one
    // call. Best-effort — a push failure must not roll back the advance.
    await notificationService
      .notify(userId, { type: 'GROWTH', title: notice.title, body: notice.body, data: notice.data })
      .catch(() => {});
  },
};
