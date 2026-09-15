import crypto from 'node:crypto';
import { Router } from 'express';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { readCookie } from '../../http/cookies.js';
import { conflict, unauthorized } from '../../http/errors.js';
import { isTest } from '../../env.js';
import { attachUser, requireAuth } from '../../auth/middleware.js';
import {
  GUEST_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  hashToken,
  issueRefreshToken,
  setAuthCookies,
  signAccessToken,
} from '../../auth/tokens.js';
import { mergeGuestCartIntoUser } from '../cart/cart.service.js';
import { publicUser } from './auth.mapper.js';

export const authRouter = Router();

/**
 * Login and register are rate limited per IP. Without this, an attacker can
 * run a credential-stuffing list against /auth/login as fast as the network
 * allows, and argon2's cost only slows them down -- it does not stop them.
 *
 * The test suite signs in dozens of times from one address in a few seconds,
 * which is exactly the traffic this is built to stop, so the cap is lifted
 * under NODE_ENV=test. It is lifted, not removed: the limiter still runs, so a
 * misconfiguration that drops the middleware entirely would still show up.
 */
export const AUTH_RATE_LIMIT = 30;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isTest ? 100_000 : AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' } },
});

// Argon2id: memory-hard, so GPU cracking of a leaked hash is expensive.
// These parameters are a deliberate balance -- ~64MB and 3 passes is roughly
// 50-80ms on a small cloud box, slow enough to matter, fast enough to log in.
const ARGON_OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
};

const registerSchema = z.object({
  // Emails are lowercased and trimmed on the way in. Otherwise "Bob@x.com"
  // and "bob@x.com" become two accounts and the unique index never fires.
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .max(200, 'That password is unreasonably long.'),
  name: z.string().trim().min(1, 'Tell us your name.').max(120),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) throw conflict('An account with that email already exists.');

    const passwordHash = await argon2.hash(body.password, ARGON_OPTS);
    const user = await prisma.user.create({
      data: { email: body.email, passwordHash, name: body.name },
    });

    // Whatever they put in the cart before signing up follows them in.
    const guestSid = readCookie(req, GUEST_COOKIE);
    if (guestSid) await mergeGuestCartIntoUser(guestSid, user.id);

    const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({ user: publicUser(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });

    // Deliberately uniform: a wrong email and a wrong password return the same
    // 401 with the same message, and a missing user still pays the cost of a
    // verify against a dummy hash. Otherwise response bodies -- or just
    // response TIMES -- tell an attacker which emails are registered.
    if (!user) {
      await argon2.verify(DUMMY_HASH, body.password).catch(() => false);
      throw unauthorized('Email or password is incorrect.');
    }

    const ok = await argon2.verify(user.passwordHash, body.password).catch(() => false);
    if (!ok) throw unauthorized('Email or password is incorrect.');

    const guestSid = readCookie(req, GUEST_COOKIE);
    if (guestSid) await mergeGuestCartIntoUser(guestSid, user.id);

    const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });
    const refreshToken = await issueRefreshToken(user.id, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ user: publicUser(user) });
  }),
);

/**
 * Rotating refresh. The presented token is revoked and a fresh one issued on
 * every call, so a stolen refresh token is usable at most once and its reuse
 * is detectable (the row is already revoked).
 */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const presented = readCookie(req, REFRESH_COOKIE);
    if (!presented) throw unauthorized('No session to refresh.');

    const row = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
      include: { user: true },
    });

    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      clearAuthCookies(res);
      throw unauthorized('Session expired. Please sign in again.');
    }

    await prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    const accessToken = signAccessToken({
      sub: row.user.id,
      role: row.user.role,
      email: row.user.email,
    });
    const nextRefresh = await issueRefreshToken(row.user.id, {
      userAgent: req.get('user-agent') ?? undefined,
      ip: req.ip,
    });
    setAuthCookies(res, accessToken, nextRefresh);

    res.json({ user: publicUser(row.user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const presented = readCookie(req, REFRESH_COOKIE);
    if (presented) {
      // updateMany, not update: an unknown hash must not throw. Logging out
      // twice, or with a stale cookie, should still clear the browser state.
      await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(presented), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      include: { addresses: { orderBy: [{ isDefault: 'desc' }, { id: 'asc' }] } },
    });
    if (!user) throw unauthorized();
    res.json({ user: publicUser(user), addresses: user.addresses });
  }),
);

const profileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).nullish(),
});

authRouter.patch(
  '/me',
  attachUser,
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      // Note what is NOT updatable here: email and role. Letting a profile
      // PATCH carry `role` is the classic mass-assignment hole -- a customer
      // promotes themselves to ADMIN with one extra JSON field.
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
      },
    });
    res.json({ user: publicUser(user) });
  }),
);

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(10, 'Use at least 10 characters.').max(200),
});

authRouter.post(
  '/change-password',
  attachUser,
  requireAuth,
  authLimiter,
  asyncHandler(async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();

    const ok = await argon2.verify(user.passwordHash, body.currentPassword).catch(() => false);
    if (!ok) throw unauthorized('Current password is incorrect.');

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await argon2.hash(body.newPassword, ARGON_OPTS) },
      }),
      // Changing a password must end every other session, otherwise the whole
      // point of changing it after a compromise is lost.
      prisma.refreshToken.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    clearAuthCookies(res);
    res.status(204).end();
  }),
);

/**
 * A REAL argon2id hash of a random string, generated once at boot, used only to
 * burn the same CPU time on a nonexistent account as on a real one.
 *
 * It has to be genuinely verifiable or the trick does not work: a hand-written
 * fake string makes argon2.verify reject on parse in microseconds, and the
 * timing gap it was meant to close is still wide open. Hashed at the same cost
 * parameters as a live password for exactly that reason.
 */
const DUMMY_HASH = await argon2.hash(crypto.randomBytes(32).toString('hex'), ARGON_OPTS);
