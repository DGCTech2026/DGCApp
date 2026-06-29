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
  registerSchema,
  registerVerifySchema,
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
import { submitCertificateSchema, adminVerifyRequirementSchema } from '../modules/growth/growth.schema';

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
  ['/api/v1/auth/register', 'Register: submit the Create Account form, emails a verification code', registerSchema, okSchema],
  ['/api/v1/auth/register/verify', 'Verify the code → creates the account + onboards, returns tokens', registerVerifySchema, tokenSchema],
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
registry.registerPath({
  method: 'delete',
  path: '/api/v1/users/me',
  tags: ['users'],
  summary: 'Delete my account (hard purge; frees the email/phone for reuse)',
  security: bearer,
  responses: { 200: { description: 'Deleted', ...json(okSchema) } },
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
  summary: 'My Journey: current stage, progress %, next action, stage checklist, badges',
  security: bearer,
  responses: { 200: { description: 'Growth summary', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/growth/requirements/{key}/complete',
  tags: ['growth'],
  summary: 'Self-attest a SELF_ATTEST requirement (advances stage when all are met)',
  security: bearer,
  request: { params: z.object({ key: z.string() }) },
  responses: { 200: { description: 'Updated growth summary', ...json(z.object({}).passthrough()) }, 400: { description: 'Not self-attestable', ...json(errorSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/growth/certificates',
  tags: ['growth'],
  summary: 'Submit a certificate for a CERTIFICATE requirement (status PENDING)',
  security: bearer,
  request: { body: json(submitCertificateSchema) },
  responses: { 201: { description: 'Certificate', ...json(z.object({}).passthrough()) } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/growth/certificates',
  tags: ['growth'],
  summary: 'My submitted certificates',
  security: bearer,
  responses: { 200: { description: 'Certificates', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'get',
  path: '/api/v1/growth/admin/certificates',
  tags: ['growth'],
  summary: 'Pending certificate verification queue (super admin)',
  security: bearer,
  responses: { 200: { description: 'Pending certificates', ...json(z.array(z.object({}).passthrough())) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/growth/admin/certificates/{id}/verify',
  tags: ['growth'],
  summary: 'Verify a certificate (records the requirement completion)',
  security: bearer,
  request: { params: z.object({ id: z.string() }) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
});
registry.registerPath({
  method: 'post',
  path: '/api/v1/growth/admin/requirements/verify',
  tags: ['growth'],
  summary: 'Admin-verify an ADMIN_VERIFY requirement for a member',
  security: bearer,
  request: { body: json(adminVerifyRequirementSchema) },
  responses: { 200: { description: 'OK', ...json(okSchema) } },
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

// Rendered as Markdown at the top of Swagger UI (/docs) — the frontend integration guide so the
// app team can self-serve the flows without a separate repo doc. Array-of-lines (single-quoted) so
// backticks/JSON quotes inside the Markdown need no escaping.
const apiDescription = [
  '# DGC Global Community API',
  '',
  'Integration guide below — base URL, headers, auth, and the sign-up / sign-in / onboarding flows. The full endpoint list is grouped by tag beneath this section.',
  '',
  '## Base URL and headers',
  '',
  '- Every endpoint is under `/api/v1` — e.g. `https://dgc-backend-bo80.onrender.com/api/v1/auth/login`.',
  '- Send `Content-Type: application/json` on every request that has a body.',
  '- Endpoints with a lock icon require the header `Authorization: Bearer <accessToken>`.',
  '- To call protected endpoints from this page, click **Authorize** (top-right) and paste an `accessToken`.',
  '',
  '> Two mistakes that have already caused bugs: forgetting `Content-Type: application/json` (the body is then ignored), and sending the OTP `code` as a number — it must be a **string** such as `"233015"`.',
  '',
  '## Responses and errors',
  '',
  'Success responses are `2xx` with a JSON body. Every error uses this exact shape:',
  '',
  '```',
  '{ "error": { "code": "BAD_REQUEST", "message": "Human-readable reason" } }',
  '```',
  '',
  'Always display `error.message`. Rendering the whole error object is what produces `[object Object]` on screen.',
  '',
  '## Tokens',
  '',
  '- `accessToken` — valid 15 minutes; send it in the `Authorization` header.',
  '- `refreshToken` — valid 30 days and rotates on every use; store it securely.',
  '- On a `401` with `"Invalid or expired token"`, call `POST /api/v1/auth/refresh`, then retry the request once.',
  '',
  '## Sign up vs. sign in — which endpoint?',
  '',
  '| Method | Sign up | Sign in |',
  '| --- | --- | --- |',
  '| Email + password | `POST /auth/register` then `/auth/register/verify` | `POST /auth/login` |',
  '| Email OTP | `email/request-otp` then `email/verify-otp` | the same call |',
  '| Google | `POST /auth/google` | the same call |',
  '| Apple / Phone | disabled | disabled |',
  '',
  'For the passwordless methods (Google, email OTP) there is **no separate login endpoint** — the backend creates the account when the user is new, or signs them in when they already exist. After the call, route using `onboardingComplete` (see Onboarding). Only email + password has separate sign-up and sign-in endpoints.',
  '',
  '> **Apple** and **Phone OTP** are not active yet (no Apple client id / SMS provider) and return a "not configured" error. Do not ship them.',
  '',
  '## Flow 1 — Email + password registration',
  '',
  '1. `POST /api/v1/auth/register` with the Create Account form, including `branchId`. Emails a 6-digit code and returns `{ "ok": true }`.',
  '2. `POST /api/v1/auth/register/verify` with `{ "email", "code" }` (code is a 6-character string). Returns `{ "accessToken", "refreshToken", "isNewUser": true }`.',
  '',
  'Because the name and branch were supplied in step 1, the account is already onboarded — go straight to the dashboard.',
  '',
  '## Flow 2 — Passwordless (Google / email OTP)',
  '',
  '- Google: `POST /api/v1/auth/google` with `{ "idToken" }`.',
  '- Email OTP: `POST /api/v1/auth/email/request-otp` with `{ "email" }`, then `POST /api/v1/auth/email/verify-otp` with `{ "email", "code" }`.',
  '',
  'Both return `{ "accessToken", "refreshToken", "isNewUser" }` and create a minimal account. Continue with Onboarding.',
  '',
  '## Onboarding (passwordless users)',
  '',
  '1. `GET /api/v1/users/me` and read `onboardingComplete`.',
  '2. When it is `false`: `GET /api/v1/branches` to fill the branch picker, then `PATCH /api/v1/users/me` with `{ "displayName", "branchId", ... }`. Setting `branchId` auto-joins the branch community and the Global Announcement channel.',
  '3. When it is `true`: go straight to the dashboard.',
  '',
  '> Use `onboardingComplete` as the source of truth (not `isNewUser`). It is `true` only when the user has both a display name and a branch, so it also catches someone who authenticated earlier but never finished onboarding.',
  '',
  '## Login, forgot password, refresh, logout',
  '',
  '- Login (email + password): `POST /api/v1/auth/login` with `{ "email", "password" }`, returns a token pair.',
  '- Forgot password: `POST /api/v1/auth/email/request-otp`, then `POST /api/v1/auth/reset-password` with `{ "email", "code", "newPassword" }` (also signs them in).',
  '- Refresh: `POST /api/v1/auth/refresh` with `{ "refreshToken" }` (no Bearer header). Returns a new pair; the old refresh token stops working.',
  '- Logout: `POST /api/v1/auth/logout` with `{ "refreshToken" }` (Bearer header).',
  '',
  '## Delete account',
  '',
  '`DELETE /api/v1/users/me` (Bearer). The account is identified from the token, so a user can only delete themselves. This is a permanent purge and frees the email/phone for reuse.',
  '',
  '## Avatar / file upload',
  '',
  '1. `POST /api/v1/media/signature` with `{ "type": "avatar" }` returns signed upload params.',
  '2. Upload the file directly to the returned `uploadUrl` (Cloudinary, multipart/form-data); Cloudinary returns a `secure_url`.',
  '3. `PATCH /api/v1/users/me` with `{ "avatarUrl": "<secure_url>" }`.',
  '',
  'Optimize images on display by inserting a transform after `/upload/`, e.g. `c_fill,g_face,w_96,h_96,dpr_auto,f_auto,q_auto` for avatars.',
  '',
  '## Realtime (Socket.io)',
  '',
  'Connect to the root host (not `/api/v1`) using the same access token:',
  '',
  '```',
  'io("https://dgc-backend-bo80.onrender.com", { auth: { token: accessToken }, transports: ["websocket"] })',
  '```',
  '',
  'On connect you are auto-joined to `user:<yourId>` (notifications) and to `channel:<id>` for every channel you belong to.',
  '',
  '- Server to client: `message:new`, `reaction:add`, `reaction:remove`, `message:pinned`, `message:unpinned`, `message:deleted`, `channel:typing` (`{ channelId, userId }`), `notification:new`.',
  '- Client to server: `channel:typing` (`{ channelId }`), `channel:join` (`{ channelId }`).',
  '',
  'Sending a message is a REST call (`POST /api/v1/channels/{channelId}/messages`); the server then broadcasts `message:new` to the channel room.',
].join('\n');

export function mountDocs(app: Express) {
  try {
    const generator = new OpenApiGeneratorV3(registry.definitions);
    const spec = generator.generateDocument({
      openapi: '3.0.0',
      info: { title: 'DGC Global Community API', version: '1.0.0', description: apiDescription },
      servers: [{ url: '/' }],
    });
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
    app.get('/openapi.json', (_req, res) => res.json(spec));
    logger.info('Swagger UI mounted at /docs');
  } catch (err) {
    logger.error({ err }, 'Failed to mount OpenAPI docs');
  }
}
