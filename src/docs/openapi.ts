import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';
import { logger } from '../infra/logger';
import {
  requestOtpSchema,
  verifyOtpSchema,
  requestPhoneOtpSchema,
  verifyPhoneOtpSchema,
  googleAuthSchema,
  appleAuthSchema,
  loginSchema,
  setPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
} from '../modules/auth/auth.schema';
import { updateMeSchema } from '../modules/users/users.schema';
import { uploadSignatureSchema } from '../modules/media/media.schema';
import { sendMessageSchema, reactionSchema } from '../modules/chat/chat.schema';
import { openDmSchema } from '../modules/channels/channels.schema';
import { createEventSchema, rsvpSchema } from '../modules/events/events.schema';
import { createBranchSchema, setRoleSchema, assignUserSchema } from '../modules/admin/admin.schema';

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const okSchema = z.object({ ok: z.boolean() });
const tokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  isNewUser: z.boolean().optional(), // true when this sign-in created the account → route to onboarding
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  city: z.string(),
  country: z.string(),
});
const meSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  globalRole: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  gender: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  occupation: z.string().nullable(),
  bio: z.string().nullable(),
  onboardingComplete: z.boolean(),
});

const json = (schema: z.ZodTypeAny) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] as string[] }];

// ---- auth ----
const publicAuth: [string, string, z.ZodTypeAny, z.ZodTypeAny][] = [
  ['/api/v1/auth/email/request-otp', 'Request an email OTP (public, rate-limited)', requestOtpSchema, okSchema],
  ['/api/v1/auth/email/verify-otp', 'Verify an email OTP and receive tokens', verifyOtpSchema, tokenSchema],
  ['/api/v1/auth/phone/request-otp', 'Request a phone OTP (public, rate-limited; needs SMS provider)', requestPhoneOtpSchema, okSchema],
  ['/api/v1/auth/phone/verify-otp', 'Verify a phone OTP and receive tokens', verifyPhoneOtpSchema, tokenSchema],
  ['/api/v1/auth/google', 'Sign in with a Google ID token', googleAuthSchema, tokenSchema],
  ['/api/v1/auth/apple', 'Sign in with an Apple ID token (needs Apple config)', appleAuthSchema, tokenSchema],
  ['/api/v1/auth/login', 'Sign in with email + password (rate-limited)', loginSchema, tokenSchema],
  ['/api/v1/auth/reset-password', 'Reset password using an email OTP code', resetPasswordSchema, tokenSchema],
  ['/api/v1/auth/refresh', 'Rotate refresh token for a new token pair', refreshTokenSchema, tokenSchema],
];
for (const [path, summary, body, ok] of publicAuth) {
  registry.registerPath({
    method: 'post',
    path,
    tags: ['auth'],
    summary,
    request: { body: json(body) },
    responses: {
      200: { description: 'Success', ...json(ok) },
      400: { description: 'Bad request', ...json(errorSchema) },
      401: { description: 'Unauthorized', ...json(errorSchema) },
      429: { description: 'Too many requests', ...json(errorSchema) },
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/password',
  tags: ['auth'],
  summary: 'Set or change your password',
  security: bearer,
  request: { body: json(setPasswordSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  summary: 'Revoke a refresh token',
  security: bearer,
  request: { body: json(refreshTokenSchema) },
  responses: { 200: { description: 'Logged out', ...json(okSchema) } },
});

// ---- users ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/users/me',
  tags: ['users'],
  summary: 'Get the authenticated user profile (with memberships + growth stage)',
  security: bearer,
  responses: {
    200: { description: 'Current user', ...json(meSchema) },
    401: { description: 'Unauthorized', ...json(errorSchema) },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/v1/users/me',
  tags: ['users'],
  summary: 'Update profile; setting branchId the first time auto-joins branch + Global Announcement',
  security: bearer,
  request: { body: json(updateMeSchema) },
  responses: {
    200: { description: 'Updated user', ...json(meSchema) },
    400: { description: 'Bad request', ...json(errorSchema) },
    409: { description: 'Already assigned to a branch', ...json(errorSchema) },
  },
});

// ---- branches ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/branches',
  tags: ['branches'],
  summary: 'List branches (public — registration picker)',
  responses: { 200: { description: 'Branches', ...json(z.array(branchSchema)) } },
});

registry.registerPath({
  method: 'get',
  path: '/api/v1/branches/{id}',
  tags: ['branches'],
  summary: 'Get a branch by id',
  request: { params: z.object({ id: z.string() }) },
  responses: {
    200: { description: 'Branch', ...json(branchSchema) },
    404: { description: 'Not found', ...json(errorSchema) },
  },
});

// ---- media ----
registry.registerPath({
  method: 'post',
  path: '/api/v1/media/signature',
  tags: ['media'],
  summary: 'Get Cloudinary signed-upload params; client uploads directly, then sends back the URL',
  security: bearer,
  request: { body: json(uploadSignatureSchema) },
  responses: {
    200: {
      description: 'Signed upload params',
      ...json(
        z.object({
          cloudName: z.string(),
          apiKey: z.string(),
          timestamp: z.number(),
          folder: z.string(),
          signature: z.string(),
          uploadUrl: z.string(),
        }),
      ),
    },
    401: { description: 'Unauthorized', ...json(errorSchema) },
  },
});

// ---- channels + chat ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/channels',
  tags: ['channels'],
  summary: 'List my channels with last message + unread count (the Chats list)',
  security: bearer,
  responses: { 200: { description: 'Channels', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/channels/dm',
  tags: ['channels'],
  summary: 'Open (or fetch) a 1:1 DM channel',
  security: bearer,
  request: { body: json(openDmSchema) },
  responses: { 201: { description: 'DM channel', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/channels/{channelId}/read',
  tags: ['channels'],
  summary: 'Mark a channel read (sets lastReadAt)',
  security: bearer,
  request: { params: z.object({ channelId: z.string() }) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/channels/{channelId}/messages',
  tags: ['chat'],
  summary: 'List messages (keyset pagination: ?cursor=&limit=)',
  security: bearer,
  request: {
    params: z.object({ channelId: z.string() }),
    query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().optional() }),
  },
  responses: { 200: { description: 'Messages + nextCursor', ...json(z.object({ messages: z.array(z.object({}).passthrough()), nextCursor: z.string().nullable() })) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/channels/{channelId}/messages',
  tags: ['chat'],
  summary: 'Send a message (read-only channels require moderator)',
  security: bearer,
  request: { params: z.object({ channelId: z.string() }), body: json(sendMessageSchema) },
  responses: {
    201: { description: 'Created message', ...json(z.object({}).passthrough()) },
    403: { description: 'Not a member / read-only', ...json(errorSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/messages/{messageId}/reactions',
  tags: ['chat'],
  summary: 'React to a message',
  security: bearer,
  request: { params: z.object({ messageId: z.string() }), body: json(reactionSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/messages/{messageId}/pin',
  tags: ['chat'],
  summary: 'Pin a message (moderator only)',
  security: bearer,
  request: { params: z.object({ messageId: z.string() }) },
  responses: { 200: { description: 'Pinned message', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'delete',
  path: '/api/v1/messages/{messageId}',
  tags: ['chat'],
  summary: 'Delete a message (sender or moderator)',
  security: bearer,
  request: { params: z.object({ messageId: z.string() }) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});

// ---- clusters ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/clusters',
  tags: ['clusters'],
  summary: 'List clusters (Recommended Clusters) with isMember + memberCount',
  security: bearer,
  responses: { 200: { description: 'Clusters', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/clusters/{clusterId}/join',
  tags: ['clusters'],
  summary: 'Join a cluster (also joins its chat channel)',
  security: bearer,
  request: { params: z.object({ clusterId: z.string() }) },
  responses: { 200: { description: 'Joined', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/clusters/{clusterId}/leave',
  tags: ['clusters'],
  summary: 'Leave a cluster',
  security: bearer,
  request: { params: z.object({ clusterId: z.string() }) },
  responses: { 200: { description: 'Left', ...json(okSchema) } },
});

// ---- growth ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/growth/me',
  tags: ['growth'],
  summary: 'My Journey summary: current stage, progress %, next action, stage checklist',
  security: bearer,
  responses: { 200: { description: 'Growth summary', ...json(z.object({}).passthrough()) } },
});

// ---- events ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/events',
  tags: ['events'],
  summary: 'Upcoming events (global + my branches + my clusters) with my RSVP',
  security: bearer,
  responses: { 200: { description: 'Events', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/events',
  tags: ['events'],
  summary: 'Create an event (branch admin / cluster moderator / super admin)',
  security: bearer,
  request: { body: json(createEventSchema) },
  responses: {
    201: { description: 'Created event', ...json(z.object({}).passthrough()) },
    403: { description: 'Not permitted', ...json(errorSchema) },
  },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/events/{eventId}',
  tags: ['events'],
  summary: 'Event detail with RSVP counts + my RSVP/check-in',
  security: bearer,
  request: { params: z.object({ eventId: z.string() }) },
  responses: { 200: { description: 'Event', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/events/{eventId}/rsvp',
  tags: ['events'],
  summary: 'RSVP to an event',
  security: bearer,
  request: { params: z.object({ eventId: z.string() }), body: json(rsvpSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/events/{eventId}/checkin',
  tags: ['events'],
  summary: 'Check in at an event (QR scan)',
  security: bearer,
  request: { params: z.object({ eventId: z.string() }) },
  responses: { 200: { description: 'Checked in', ...json(okSchema) } },
});

// ---- notifications ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/notifications',
  tags: ['notifications'],
  summary: 'List my notifications + unread count',
  security: bearer,
  responses: { 200: { description: 'Notifications', ...json(z.object({ items: z.array(z.object({}).passthrough()), unreadCount: z.number() })) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/notifications/read-all',
  tags: ['notifications'],
  summary: 'Mark all my notifications read',
  security: bearer,
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/notifications/{id}/read',
  tags: ['notifications'],
  summary: 'Mark a notification read',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});

// ---- admin (super admin only) ----
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/analytics',
  tags: ['admin'],
  summary: 'Dashboard analytics: counts, branch + leadership-pipeline breakdowns',
  security: bearer,
  responses: { 200: { description: 'Analytics', ...json(z.object({}).passthrough()) }, 403: { description: 'Super admin only', ...json(errorSchema) } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/admin/users',
  tags: ['admin'],
  summary: 'List/search members',
  security: bearer,
  request: { query: z.object({ search: z.string().optional() }) },
  responses: { 200: { description: 'Users', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/users/{userId}/role',
  tags: ['admin'],
  summary: 'Set a user global role',
  security: bearer,
  request: { params: z.object({ userId: z.string() }), body: json(setRoleSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/branches',
  tags: ['admin'],
  summary: 'Create a branch (auto-provisions section channels)',
  security: bearer,
  request: { body: json(createBranchSchema) },
  responses: { 201: { description: 'Branch', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/admin/branches/{branchId}/admins',
  tags: ['admin'],
  summary: 'Assign a branch admin',
  security: bearer,
  request: { params: z.object({ branchId: z.string() }), body: json(assignUserSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});

export function mountDocs(app: Express) {
  try {
    const generator = new OpenApiGeneratorV3(registry.definitions);
    const spec = generator.generateDocument({
      openapi: '3.0.0',
      info: { title: 'DGC Global Community API', version: '1.0.0' },
      servers: [{ url: '/' }],
    });
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
    app.get('/openapi.json', (_req, res) => res.json(spec));
    logger.info('Swagger UI mounted at /docs');
  } catch (err) {
    logger.error({ err }, 'Failed to mount OpenAPI docs');
  }
}
