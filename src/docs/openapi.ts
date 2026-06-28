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
  refreshTokenSchema,
} from '../modules/auth/auth.schema';
import { updateMeSchema } from '../modules/users/users.schema';

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
