import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { Role } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../prisma.js';

export const ACCESS_COOKIE = 'shop_at';
export const REFRESH_COOKIE = 'shop_rt';
export const GUEST_COOKIE = 'shop_sid';

/**
 * A deliberately READABLE flag saying "this browser has a session".
 *
 * The real credentials are httpOnly, which is what makes them safe from XSS --
 * but it also means the SPA cannot tell a signed-out visitor from a signed-in
 * one without asking. Asking meant every anonymous page load fired GET /auth/me,
 * took a 401, tried a refresh, and took a second 401: two wasted round trips and
 * two red errors in the console of a page that was working perfectly.
 *
 * This cookie carries no identity, no token and no claim -- just the value "1".
 * Forging it grants nothing; it only makes the client bother to ask, and the
 * answer is still 401. It is a performance and cleanliness hint, never a gate.
 */
export const SESSION_HINT_COOKIE = 'shop_session';

export interface AccessClaims {
  sub: string;
  role: Role;
  email: string;
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL,
    issuer: 'shop-api',
    audience: 'shop-web',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessClaims {
  // Issuer and audience are verified, not just the signature. Otherwise any
  // token signed with the same secret by any other service is accepted here.
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'shop-api',
    audience: 'shop-web',
  });
  if (typeof payload === 'string') throw new Error('Malformed access token.');
  return payload as unknown as AccessClaims;
}

/**
 * Refresh tokens are opaque random strings, not JWTs, and only their SHA-256
 * hash is stored. That means:
 *  - a database leak does not yield usable sessions
 *  - revocation is real (delete/stamp the row), unlike a stateless JWT which
 *    stays valid until it expires no matter what the server thinks
 */
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined },
): Promise<string> {
  const { token, hash } = newRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 255) ?? null,
      ip: meta.ip ?? null,
    },
  });
  return token;
}

const baseCookie = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: '/',
} as const;

export function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  // httpOnly on both: no script on the page can read them, so an XSS bug cannot
  // walk off with a session. This is why tokens are not returned in the JSON
  // body for the SPA to stash in localStorage.
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie, maxAge: 60 * 60 * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, {
    ...baseCookie,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
  // Explicitly NOT httpOnly -- the whole point is that the SPA can read it.
  // Its lifetime tracks the refresh token, so it expires with the session.
  res.cookie(SESSION_HINT_COOKIE, '1', {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie });
  // Cleared with matching attributes. A clearCookie whose path or sameSite
  // differs from the original leaves the old cookie in place, and the client
  // goes on believing it has a session that the server has already dropped.
  res.clearCookie(SESSION_HINT_COOKIE, {
    httpOnly: false,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE,
    path: '/',
  });
}

export function setGuestCookie(res: Response, sessionId: string): void {
  // Not httpOnly-sensitive in the same way -- it identifies a cart, not a user
  // -- but there is no reason for JS to read it either, so it stays httpOnly.
  res.cookie(GUEST_COOKIE, sessionId, { ...baseCookie, maxAge: 180 * 86_400_000 });
}

export function newGuestSessionId(): string {
  return crypto.randomBytes(24).toString('base64url');
}
