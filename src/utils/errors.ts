export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const BadRequest = (m: string) => new AppError(400, 'BAD_REQUEST', m);
export const Unauthorized = (m = 'Unauthorized') => new AppError(401, 'UNAUTHORIZED', m);
export const Forbidden = (m = 'Forbidden') => new AppError(403, 'FORBIDDEN', m);
export const NotFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const Conflict = (m: string) => new AppError(409, 'CONFLICT', m);
export const TooManyRequests = (m = 'Too many requests') => new AppError(429, 'TOO_MANY_REQUESTS', m);
