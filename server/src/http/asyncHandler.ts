import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from async handlers -- the request
 * just hangs until the client times out, with nothing in the logs. Every async
 * route in this codebase is wrapped in this, so a thrown AppError becomes a
 * real HTTP response instead of a silent stall.
 */
export const asyncHandler =
  <T extends Request = Request>(
    fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    void Promise.resolve(fn(req as T, res, next)).catch(next);
  };
