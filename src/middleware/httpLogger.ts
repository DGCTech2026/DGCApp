import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import pinoHttp from 'pino-http';
import { logger } from '../infra/logger';

type RequestWithUser = IncomingMessage & {
  id?: string | number;
  user?: { sub?: string; role?: string };
};

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse) => {
    const header = req.headers['x-request-id'];
    const requestId = Array.isArray(header) ? header[0] : header;
    const id = requestId || randomUUID();

    res.setHeader('x-request-id', id);
    return id;
  },
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/metrics',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req: IncomingMessage) => {
    const request = req as RequestWithUser;
    return {
      requestId: request.id,
      userId: request.user?.sub,
      userRole: request.user?.role,
    };
  },
});
