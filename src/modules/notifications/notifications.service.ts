import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/db';
import { emitToUser } from '../../infra/realtime';
import { NotFound } from '../../utils/errors';

type NotifType = 'MESSAGE' | 'MENTION' | 'GROWTH' | 'EVENT' | 'REPORT' | 'SYSTEM';

const SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
};

export const notificationService = {
  // Create an in-app notification and push it live to the user's socket room.
  // (FCM push fan-out is deferred — that goes through the notification BullMQ worker later.)
  async notify(userId: string, input: { type: NotifType; title: string; body?: string; data?: Prisma.InputJsonValue }) {
    const n = await prisma.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        ...(input.data !== undefined ? { data: input.data } : {}),
      },
      select: SELECT,
    });
    emitToUser(userId, 'notification:new', n);
    return n;
  },

  async listMine(userId: string) {
    const [items, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: SELECT }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { items, unreadCount };
  },

  async markRead(userId: string, id: string) {
    const n = await prisma.notification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!n) throw NotFound('Notification not found');
    await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
    return { ok: true };
  },

  async markAllRead(userId: string) {
    await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  },
};
