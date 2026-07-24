import type { ErrorRequestHandler } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../infra/logger';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  logger.error(
    {
      err,
      requestId: (req as typeof req & { id?: string | number }).id,
      sentryEventId: (res as typeof res & { sentry?: string }).sentry,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.sub,
    },
    'Unhandled request error',
  );
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
