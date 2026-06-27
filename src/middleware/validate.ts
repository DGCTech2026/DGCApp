import type { RequestHandler } from 'express';
import type { ZodSchema } from 'zod';
import { BadRequest } from '../utils/errors';

export const validate =
  (schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body'): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(BadRequest(result.error.issues.map(i => i.message).join(', ')));
    (req as unknown as Record<string, unknown>)[source] = result.data;
    next();
  };
