import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { prisma } from '../../infra/db';
import { logger } from '../../infra/logger';
import { eventService } from '../../modules/events/events.service';
import { pushService } from '../../modules/push/push.service';

const connection = { url: env.REDIS_URL, maxRetriesPerRequest: null as null };
const BATCH = 1000;

export const notificationWorker = new Worker(
  'notification',
  async (job) => {
    // Scheduled scan: send pre-event reminders to attendees (PRD §9).
    if (job.name === 'event-reminders-scan') {
      const result = await eventService.sendDueEventReminders();
      logger.info({ jobId: job.id, ...result }, 'Event reminders processed');
      return;
    }

    // Announcement fan-out (§4/§12): one Notification row per channel member, batched so a 10k-member
    // broadcast never blocks the request path. FCM push delivery will hook in here next.
    if (job.name === 'announcement-fanout') {
      const { channelId, messageId, title, body, excludeUserId } = job.data as {
        channelId: string;
        messageId: string;
        title: string;
        body?: string | null;
        excludeUserId?: string;
      };
      const members = await prisma.channelMembership.findMany({
        where: { channelId, mutedAt: null, ...(excludeUserId ? { userId: { not: excludeUserId } } : {}) },
        select: { userId: true },
      });
      let created = 0;
      for (let i = 0; i < members.length; i += BATCH) {
        const chunk = members.slice(i, i + BATCH).map((m) => ({
          userId: m.userId,
          type: 'ANNOUNCEMENT' as const,
          title,
          body: body ?? null,
          data: { channelId, messageId },
        }));
        const res = await prisma.notification.createMany({ data: chunk });
        created += res.count;
      }
      await pushService.sendToUsers(members.map((m) => m.userId), { title, body: body ?? null, data: { channelId, messageId } });
      logger.info({ jobId: job.id, channelId, created }, 'Announcement fan-out complete');
      return;
    }

    // Group/channel message fan-out: notifies every non-muted member except the sender.
    // Batched DB inserts + batched FCM push. Runs off the request path so sending stays fast.
    if (job.name === 'message-fanout') {
      const { channelId, messageId, senderId, senderName, body } = job.data as {
        channelId: string;
        messageId: string;
        senderId: string;
        senderName: string;
        body: string | null;
      };
      const members = await prisma.channelMembership.findMany({
        where: { channelId, userId: { not: senderId }, mutedAt: null },
        select: { userId: true },
      });
      if (!members.length) return;

      let created = 0;
      const title = senderName || 'New message';
      const notifBody = body || 'Sent a message';
      for (let i = 0; i < members.length; i += BATCH) {
        const chunk = members.slice(i, i + BATCH).map((m) => ({
          userId: m.userId,
          type: 'MESSAGE' as const,
          title,
          body: notifBody,
          data: { channelId, messageId },
        }));
        const res = await prisma.notification.createMany({ data: chunk });
        created += res.count;
      }
      await pushService.sendToUsers(
        members.map((m) => m.userId),
        { title, body: notifBody, data: { channelId, messageId } },
      );
      logger.info({ jobId: job.id, channelId, created }, 'Message fan-out complete');
      return;
    }

    logger.info({ jobId: job.id, name: job.name }, 'Notification job received (no handler)');
  },
  { connection },
);

notificationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Notification job failed');
});
