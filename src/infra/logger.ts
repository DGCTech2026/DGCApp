import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL ?? (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: env.SERVICE_NAME, env: env.NODE_ENV },
  redact: {
    censor: '[redacted]',
    paths: [
      'password',
      'code',
      'token',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});
