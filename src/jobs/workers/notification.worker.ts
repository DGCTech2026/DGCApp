import { Worker } from 'bullmq';
import { env } from '../../config/env';
import { prisma } from '../../infra/db';
import { logger } from '../../infra/logger';
import { instrumentWorker } from '../../infra/metrics';
import { captureJobException } from '../../instrument';
import { eventService } from '../../modules/events/events.service';
import { audioRoomService } from '../../modules/audio-rooms/audio-rooms.service';
import { notificationService } from '../../modules/notifications/notifications.service';
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

    // Scheduled scan: "starting soon" reminders for scheduled audio rooms (PRD §8/§12).
    if (job.name === 'audio-room-reminders-scan') {
      const result = await audioRoomService.sendDueRoomReminders();
      if (result.rooms > 0) logger.info({ jobId: job.id, ...result }, 'Audio room reminders processed');
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
      await pushService.sendToUsers(
        members.map((m) => m.userId),
        { title, body: body ?? null, data: { channelId, messageId } },
      );
      logger.info({ jobId: job.id, channelId, created }, 'Announcement fan-out complete');
      return;
    }

    // Group/channel message fan-out: FCM push ONLY to non-muted members — no Notification rows.
    // Persisting a row per member per group message would grow the table by thousands of rows a
    // day for one busy channel; in-app notification entries are reserved for DMs, mentions,
    // announcements, and events (WhatsApp semantics).
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
      await pushService.sendToUsers(
        members.map((m) => m.userId),
        { title: senderName || 'New message', body: body || 'Sent a message', data: { channelId, messageId } },
      );
      return;
    }

    // DM notification — the recipient lookup, mute check, row insert, socket emit and push all
    // happen here instead of inside the sender's request.
    if (job.name === 'dm-notify') {
      const { channelId, messageId, senderId, senderName, body } = job.data as {
        channelId: string;
        messageId: string;
        senderId: string;
        senderName: string;
        body: string | null;
      };
      const other = await prisma.channelMembership.findFirst({
        where: { channelId, userId: { not: senderId } },
        select: { userId: true, mutedAt: true },
      });
      if (!other || other.mutedAt) return;
      await notificationService.notify(other.userId, {
        type: 'MESSAGE',
        title: senderName,
        body: body ?? 'Sent you a message',
        data: { channelId, messageId },
      });
      return;
    }

    // @mention notifications — filters targets to actual non-muted channel members.
    if (job.name === 'mention-fanout') {
      const { channelId, messageId, senderName, body, targets } = job.data as {
        channelId: string;
        messageId: string;
        senderName: string;
        body: string | null;
        targets: string[];
      };
      const members = await prisma.channelMembership.findMany({
        where: { channelId, userId: { in: targets }, mutedAt: null },
        select: { userId: true },
      });
      for (const m of members) {
        await notificationService.notify(m.userId, {
          type: 'MENTION',
          title: `${senderName} mentioned you`,
          body: body ?? '',
          data: { channelId, messageId },
        });
      }
      return;
    }

    if (job.name === 'audio-room-started') {
      const { roomId, title, userIds } = job.data as {
        roomId: string;
        title: string;
        userIds: string[];
      };
      for (let i = 0; i < userIds.length; i += BATCH) {
        const chunk = userIds.slice(i, i + BATCH).map((userId) => ({
          userId,
          type: 'SYSTEM' as const,
          title: 'Audio room is live',
          body: title,
          data: { roomId },
        }));
        await prisma.notification.createMany({ data: chunk });
      }
      await pushService.sendToUsers(userIds, {
        title: 'Audio room is live',
        body: title,
        data: { roomId },
      });
      logger.info({ jobId: job.id, roomId, notified: userIds.length }, 'Audio room start notification complete');
      return;
    }

    // Daily janitor — keeps hot tables lean. Everything deleted here is already invisible to users.
    if (job.name === 'janitor-scan') {
      const now = new Date();
      const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      const [otps, readNotifs, oldNotifs, reminders, staleTokens] = await Promise.all([
        prisma.otp.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.notification.deleteMany({ where: { readAt: { not: null, lt: days(30) } } }),
        prisma.notification.deleteMany({ where: { createdAt: { lt: days(90) } } }),
        prisma.audioRoomReminder.deleteMany({ where: { room: { status: 'ENDED' } } }),
        // Rotated refresh tokens are kept briefly (revokedAt) for the flaky-network retry grace
        // window; rows older than a day — or past the 30d JWT lifetime — are dead weight.
        prisma.refreshToken.deleteMany({
          where: { OR: [{ revokedAt: { lt: days(1) } }, { createdAt: { lt: days(31) } }] },
        }),
      ]);
      logger.info(
        {
          jobId: job.id,
          expiredOtps: otps.count,
          readNotifications: readNotifs.count,
          oldNotifications: oldNotifs.count,
          staleReminders: reminders.count,
          staleRefreshTokens: staleTokens.count,
        },
        'Janitor scan complete',
      );
      return;
    }

    logger.info({ jobId: job.id, name: job.name }, 'Notification job received (no handler)');
  },
  { connection },
);

notificationWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err }, 'Notification job failed');
  captureJobException('notification', job, err);
});

instrumentWorker(notificationWorker, 'notification');
