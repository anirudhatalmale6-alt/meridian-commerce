import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import {
  ACCESS_COOKIE,
  GUEST_COOKIE,
  newGuestSessionId,
  setGuestCookie,
  verifyAccessToken,
} from './tokens.js';
import { forbidden, unauthorized } from '../http/errors.js';
import { readCookie } from '../http/cookies.js';
import { prisma } from '../prisma.js';

export interface AuthedUser {
  id: string;
  role: Role;
  email: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
      guestSessionId?: string;
    }
  }
}

function readToken(req: Request): string | null {
  const cookie = readCookie(req, ACCESS_COOKIE);
  if (cookie) return cookie;
  // Bearer is also accepted so the API stays usable from curl and from any
  // future mobile client that cannot hold cookies.
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/**
 * Populates req.user when a valid token is present, and does nothing when it
 * is not. It never rejects -- that is `requireAuth`'s job. Splitting the two
 * keeps "who is this, if anyone" separate from "this route needs a login",
 * so no route accidentally gets its guard from the parsing step.
 */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = readToken(req);
  if (!token) return next();
  try {
    const claims = verifyAccessToken(token);
    req.user = { id: claims.sub, role: claims.role, email: claims.email };
  } catch {
    // An expired or forged token is treated as "not signed in", not as an
    // error. The client refreshes via /auth/refresh and retries.
  }
  next();
}

/** Ensures every request has a cart identity, signed in or not. */
export function attachGuestSession(req: Request, res: Response, next: NextFunction): void {
  const existing = readCookie(req, GUEST_COOKIE);
  // A short value is treated as absent: a truncated or hand-edited cookie must
  // not become a cart key that collides with somebody else's.
  if (existing && existing.length >= 16) {
    req.guestSessionId = existing;
    return next();
  }
  const sid = newGuestSessionId();
  req.guestSessionId = sid;
  setGuestCookie(res, sid);
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Role gate that re-reads the role from the DATABASE rather than trusting the
 * claim baked into the token.
 *
 * The claim is a snapshot from up to ACCESS_TOKEN_TTL ago. If an admin is
 * demoted or suspended, a token minted a minute earlier still says ADMIN and a
 * claim-only check honours it. For customer-scoped reads that window is
 * tolerable; for anything that can mutate the catalogue or mark money as
 * received, it is not. So the source of truth for authorisation is the row,
 * not the bearer's copy of it.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    // Order matters: answer "are you signed in" before "are you an admin", so
    // an anonymous caller gets 401 (go log in) rather than 403 (you are not
    // allowed), which is both more correct and less confusing to debug.
    if (!req.user) return next(unauthorized());

    void prisma.user
      .findUnique({ where: { id: req.user.id }, select: { role: true } })
      .then((row) => {
        // Deleted user holding a still-valid token: treat as signed out.
        if (!row) return next(unauthorized());
        if (!roles.includes(row.role)) return next(forbidden());
        // Keep req.user honest for the rest of the request.
        if (req.user) req.user.role = row.role;
        next();
      })
      .catch(next);
  };
}
