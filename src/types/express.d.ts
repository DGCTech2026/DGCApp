import type { AccessTokenPayload } from '../utils/jwt';

// Augments Express's Request so `req.user` is typed everywhere after `authenticate`.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenPayload;
    }
  }
}

export {};
