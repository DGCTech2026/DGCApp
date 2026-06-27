import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import swaggerUi from 'swagger-ui-express';
import type { Express } from 'express';
import { logger } from '../infra/logger';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  googleAuthSchema,
} from '../modules/auth/auth.schema';

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const okSchema = z.object({ ok: z.boolean() });
const tokenSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

function jsonBody(schema: z.ZodTypeAny) {
  return { content: { 'application/json': { schema } } };
}

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/email/request-otp',
  tags: ['auth'],
  summary: 'Request an email OTP (public, rate-limited)',
  request: { body: jsonBody(requestOtpSchema) },
  responses: {
    200: { description: 'OTP enqueued', ...jsonBody(okSchema) },
    429: { description: 'Too many requests', ...jsonBody(errorSchema) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/email/verify-otp',
  tags: ['auth'],
  summary: 'Verify an email OTP and receive tokens (public)',
  request: { body: jsonBody(verifyOtpSchema) },
  responses: {
    200: { description: 'Access + refresh tokens', ...jsonBody(tokenSchema) },
    400: { description: 'Invalid/expired OTP', ...jsonBody(errorSchema) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/google',
  tags: ['auth'],
  summary: 'Sign in with a Google ID token (public)',
  request: { body: jsonBody(googleAuthSchema) },
  responses: {
    200: { description: 'Access + refresh tokens', ...jsonBody(tokenSchema) },
    401: { description: 'Invalid Google token', ...jsonBody(errorSchema) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/refresh',
  tags: ['auth'],
  summary: 'Rotate refresh token for a new token pair (public)',
  request: { body: jsonBody(refreshTokenSchema) },
  responses: {
    200: { description: 'New access + refresh tokens', ...jsonBody(tokenSchema) },
    401: { description: 'Invalid/revoked refresh token', ...jsonBody(errorSchema) },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['auth'],
  summary: 'Revoke a refresh token',
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(refreshTokenSchema) },
  responses: { 200: { description: 'Logged out', ...jsonBody(okSchema) } },
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
    // Docs are non-critical — never let a spec-gen issue crash the server.
    logger.error({ err }, 'Failed to mount OpenAPI docs');
  }
}
