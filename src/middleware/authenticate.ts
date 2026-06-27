import type { RequestHandler } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { Unauthorized } from '../utils/errors';

export const authenticate: RequestHandler = (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(Unauthorized());
  try {
    req.user = verifyAccessToken(h.slice(7));
    next();
  } catch {
    next(Unauthorized('Invalid or expired token'));
  }
};
