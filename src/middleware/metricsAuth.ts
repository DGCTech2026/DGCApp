import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env';

export const metricsAuth: RequestHandler = (req, res, next) => {
  if (!env.METRICS_TOKEN) return next();

  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  if (constantTimeEquals(token, env.METRICS_TOKEN)) return next();

  return res.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Metrics token required' },
  });
};

function constantTimeEquals(received: string, expected: string) {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}
