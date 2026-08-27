import { prisma } from '../../infra/db';
import { fcm, isPushConfigured } from '../../infra/fcm';
import { logger } from '../../infra/logger';
import { BadRequest } from '../../utils/errors';
import { looksLikeRawApnsToken } from '../../utils/pushToken';
import type { Message } from 'firebase-admin/messaging';

type Platform = 'ANDROID' | 'IOS' | 'WEB';
type PushPayload = { title: string; body?: string | null; data?: Record<string, unknown> };
type IncomingCallPushPayload = PushPayload & { ttlMs?: number };
type TokenMessage = Extract<Message, { token: string }>;
type StoredDeviceToken = { token: string; platform: Platform };

// FCM data values must all be strings.
function stringifyDataValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function toStringMap(data?: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data ?? {})) {
    const value = stringifyDataValue(v);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

function isDeadTokenError(code?: string, message?: string): boolean {
  if (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/mismatched-credential'
  ) {
    return true;
  }
  if (code !== 'messaging/invalid-argument') return false;
  return /registration token|token is not a valid|invalid registration/i.test(message ?? '');
}

async function pruneRawApnsTokens(rows: StoredDeviceToken[]): Promise<StoredDeviceToken[]> {
  const invalid = rows.filter((row) => row.platform === 'IOS' && looksLikeRawApnsToken(row.token));
  if (invalid.length) {
    logger.warn({ count: invalid.length }, 'raw APNs device tokens were stored as FCM tokens; pruning');
    await prisma.deviceToken.deleteMany({ where: { token: { in: invalid.map((row) => row.token) } } });
  }
  return rows.filter((row) => !(row.platform === 'IOS' && looksLikeRawApnsToken(row.token)));
}

// Push to a set of tokens; prune any that FCM reports as dead (uninstalled / expired).
async function sendToTokens(rows: StoredDeviceToken[], p: PushPayload) {
  if (!rows.length) return;
  const validRows = await pruneRawApnsTokens(rows);
  const tokens = validRows.map((row) => row.token);
  if (!tokens.length) return;
  const res = await fcm().sendEachForMulticast({
    tokens,
    notification: { title: p.title, ...(p.body ? { body: p.body } : {}) },
    data: toStringMap(p.data),
    apns: {
      headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
      payload: {
        aps: {
          alert: { title: p.title, ...(p.body ? { body: p.body } : {}) },
          sound: 'default',
          mutableContent: true,
        },
      },
    },
  });
  const dead: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const code = r.error?.code;
      logger.warn({ token: tokens[i]?.slice(0, 12), code, message: r.error?.message }, 'push delivery failed');
      if (isDeadTokenError(code, r.error?.message)) {
        dead.push(tokens[i]!);
      }
    }
  });
  logger.info({
    total: tokens.length,
    ios: validRows.filter((row) => row.platform === 'IOS').length,
    android: validRows.filter((row) => row.platform === 'ANDROID').length,
    web: validRows.filter((row) => row.platform === 'WEB').length,
    success: res.successCount,
    failure: res.failureCount,
  }, 'push batch result');
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
        logger.warn({ token: token.slice(0, 12), code, message: r.error?.message }, 'push delivery failed');
        if (isDeadTokenError(code, r.error?.message)) {
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
    if (platform === 'IOS' && looksLikeRawApnsToken(token)) {
      throw BadRequest('iOS push registration must send the Firebase FCM token, not the raw APNs device token');
    }
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
    const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true, platform: true } });
    await sendToTokens(rows, p).catch((err) => logger.error({ err, userId }, 'push send failed'));
  },

  async sendToUsers(userIds: string[], p: PushPayload) {
    if (!isPushConfigured() || !userIds.length) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true, platform: true } });
    const validRows = await pruneRawApnsTokens(rows);
    // FCM multicast caps at 500 tokens per call. Batches ran sequentially before — a 10k-user
    // fan-out took ~30s (10k / 500 = 20 batches × ~1.5s). Bounded concurrency of 5 cuts that
    // to ~6s without swamping the single Render instance's HTTP pool. Each batch still swallows
    // its own error so one FCM failure doesn't abort the whole fan-out.
    const CONCURRENCY = 5;
    const batches: StoredDeviceToken[][] = [];
    for (let i = 0; i < validRows.length; i += 500) batches.push(validRows.slice(i, i + 500));
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
    const rows = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true, platform: true } });
    const validRows = await pruneRawApnsTokens(rows);
    const messages = validRows.map((row) => incomingCallMessage(row.token, p));
    await sendTokenMessages(messages).catch((err) => logger.error({ err, userId }, 'incoming call push failed'));
  },

  async sendIncomingCallToUsers(userIds: string[], p: IncomingCallPushPayload) {
    if (!isPushConfigured() || !userIds.length) return;
    const rows = await prisma.deviceToken.findMany({ where: { userId: { in: userIds } }, select: { token: true, platform: true } });
    const validRows = await pruneRawApnsTokens(rows);
    const messages = validRows.map((row) => incomingCallMessage(row.token, p));
    await sendTokenMessages(messages).catch((err) => logger.error({ err }, 'incoming group call push failed'));
  },
};
