import { prisma } from '../../infra/db';
import { fcm, isPushConfigured } from '../../infra/fcm';
import { logger } from '../../infra/logger';
import type { Message } from 'firebase-admin/messaging';

type Platform = 'ANDROID' | 'IOS' | 'WEB';
type PushPayload = { title: string; body?: string | null; data?: Record<string, unknown> };
type IncomingCallPushPayload = PushPayload & { ttlMs?: number };
type TokenMessage = Extract<Message, { token: string }>;

// FCM data values must all be strings.
function toStringMap(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) if (v !== null && v !== undefined) out[k] = String(v);
  return out;
}

// Push to a set of tokens; prune any that FCM reports as dead (uninstalled / expired).
async function sendToTokens(tokens: string[], p: PushPayload) {
  if (!tokens.length) return;
  const res = await fcm().sendEachForMulticast({
    tokens,
    notification: { title: p.title, ...(p.body ? { body: p.body } : {}) },
    data: toStringMap(p.data),
  });
  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
        dead.push(tokens[i]!);
      }
    }
  });
  if (dead.length) await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
}

async function sendTokenMessages(messages: TokenMessage[]) {
  for (let i = 0; i < messages.length; i += 500) {
    const chunk = messages.slice(i, i + 500);
    if (!chunk.length) continue;
    const res = await fcm().sendEach(chunk);
    const dead: string[] = [];
    res.responses.forEach((r, index) => {
      const token = chunk[index]?.token;
      if (!r.success && token) {
        const code = r.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
          dead.push(token);
        }
      }
    });
    if (dead.length) await prisma.deviceToken.deleteMany({ where: { token: { in: dead } } });
  }
}

function incomingCallMessage(token: string, p: IncomingCallPushPayload): TokenMessage {
  const ttl = Math.max(1_000, Math.min(p.ttlMs ?? 30_000, 30_000));
  const title = p.title;
  const body = p.body ?? 'Incoming call';
  const data = toStringMap({
    ...p.data,
    priority: 'high',
    clickAction: 'INCOMING_CALL',
    androidChannelId: 'calls',
    androidFullScreenIntent: true,
    androidForegroundService: true,
    iosCallKit: true,
    iosPushType: 'voip',
  });
  const callId = data['callId'] ?? 'incoming-call';

  return {
    token,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      ttl,
      directBootOk: true,
      data,
      notification: {
        title,
        body,
        channelId: 'calls',
        priority: 'max',
        sound: 'default',
        tag: callId,
        clickAction: 'INCOMING_CALL',
        sticky: true,
        visibility: 'public',
        localOnly: true,
        defaultSound: true,
        defaultVibrateTimings: true,
        eventTimestamp: new Date(),
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        'apns-expiration': String(Math.floor((Date.now() + ttl) / 1000)),
      },
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
          category: 'INCOMING_CALL',
          threadId: `call:${callId}`,
          contentAvailable: true,
          mutableContent: true,
        },
        call: data,
      },
    },
    webpush: {
      headers: { Urgency: 'high', TTL: String(Math.ceil(ttl / 1000)) },
      notification: { title, body, tag: callId, requireInteraction: true, data },
    },
    fcmOptions: { analyticsLabel: 'incoming_call' },
  };
}

export const pushService = {
  async registerDevice(userId: string, token: string, platform: Platform, voipToken?: string) {
    await prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform, voipToken: voipToken ?? null },
      update: { userId, platform, voipToken: voipToken ?? undefined },
    });
    return { ok: true };
  },

  async removeDevice(userId: string, token: string) {
    await prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  },

  // Fire-and-forget helpers — a push failure must never break the thing that triggered it.
  async sendToUser(userId: string, p: PushPayload) {
    if (!isPushConfigured()) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
    await sendToTokens(rows.map((t) => t.token), p).catch((err) => logger.error({ err, userId }, 'push send failed'));
  },

  async sendToUsers(userIds: string[], p: PushPayload) {
    if (!isPushConfigured() || !userIds.length) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
    const tokens = rows.map((r) => r.token);
    // FCM multicast caps at 500 tokens per call. Batches ran sequentially before — a 10k-user
    // fan-out took ~30s (10k / 500 = 20 batches × ~1.5s). Bounded concurrency of 5 cuts that
    // to ~6s without swamping the single Render instance's HTTP pool. Each batch still swallows
    // its own error so one FCM failure doesn't abort the whole fan-out.
    const CONCURRENCY = 5;
    const batches: string[][] = [];
    for (let i = 0; i < tokens.length; i += 500) batches.push(tokens.slice(i, i + 500));
    for (let i = 0; i < batches.length; i += CONCURRENCY) {
      await Promise.all(
        batches.slice(i, i + CONCURRENCY).map((batch) =>
          sendToTokens(batch, p).catch((err) => logger.error({ err }, 'push batch failed')),
        ),
      );
    }
  },

  async sendIncomingCallToUser(userId: string, p: IncomingCallPushPayload) {
    if (!isPushConfigured()) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
    const messages = rows.map((row) => incomingCallMessage(row.token, p));
    await sendTokenMessages(messages).catch((err) => logger.error({ err, userId }, 'incoming call push failed'));
  },

  async sendIncomingCallToUsers(userIds: string[], p: IncomingCallPushPayload) {
    if (!isPushConfigured() || !userIds.length) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
    const messages = rows.map((row) => incomingCallMessage(row.token, p));
    await sendTokenMessages(messages).catch((err) => logger.error({ err }, 'incoming group call push failed'));
  },
};
