import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Role } from '@prisma/client';
import { app, agent, createUser, resetDatabase, signIn } from './helpers.js';
import { prisma } from '../src/prisma.js';

beforeAll(async () => {
  await resetDatabase();
  await createUser('shopper@test.local', 'Correct!Horse9');
  await createUser('boss@test.local', 'Admin!Passw0rd', Role.ADMIN);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('registration', () => {
  it('creates a CUSTOMER and never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'fresh@test.local', password: 'Correct!Horse9', name: 'Fresh' });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('lowercases the email so one address cannot become two accounts', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  MiXeD@Test.Local ', password: 'Correct!Horse9', name: 'Mixed' });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('mixed@test.local');

    // The same address in a different case must now collide.
    const dupe = await request(app)
      .post('/api/auth/register')
      .send({ email: 'MIXED@TEST.LOCAL', password: 'Correct!Horse9', name: 'Dupe' });
    expect(dupe.status).toBe(409);
  });

  it('rejects a short password with a field-level message', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@test.local', password: 'short', name: 'Weak' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.some((d: { path: string }) => d.path === 'password')).toBe(true);
  });

  it('cannot set its own role to ADMIN at registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'wannabe@test.local',
      password: 'Correct!Horse9',
      name: 'Wannabe',
      role: 'ADMIN',
    });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('CUSTOMER');

    const row = await prisma.user.findUnique({ where: { email: 'wannabe@test.local' } });
    expect(row?.role).toBe('CUSTOMER');
  });
});

describe('login', () => {
  it('sets httpOnly auth cookies and a readable session hint', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'shopper@test.local', password: 'Correct!Horse9' });

    expect(res.status).toBe(200);

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const access = cookies.find((c) => c.startsWith('shop_at='));
    const refresh = cookies.find((c) => c.startsWith('shop_rt='));
    const hint = cookies.find((c) => c.startsWith('shop_session='));

    // The credentials must be unreadable by page scripts...
    expect(access).toMatch(/HttpOnly/);
    expect(refresh).toMatch(/HttpOnly/);
    // ...and the hint must NOT be, or the client cannot use it.
    expect(hint).toBeDefined();
    expect(hint).not.toMatch(/HttpOnly/);
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'shopper@test.local', password: 'not-the-password' });

    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@test.local', password: 'not-the-password' });

    // Any difference here is an account-enumeration oracle.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
  });

  it('stores the refresh token hashed, never in plaintext', async () => {
    const a = agent();
    await a
      .post('/api/auth/login')
      .send({ email: 'shopper@test.local', password: 'Correct!Horse9' });

    const rows = await prisma.refreshToken.findMany({
      where: { user: { email: 'shopper@test.local' } },
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // SHA-256 hex, and nothing that looks like the base64url token itself.
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('session lifecycle', () => {
  it('rotates the refresh token and kills the presented one', async () => {
    const a = agent();
    const login = await a
      .post('/api/auth/login')
      .send({ email: 'shopper@test.local', password: 'Correct!Horse9' });

    const firstCookies = login.headers['set-cookie'] as unknown as string[];
    const firstRefresh = firstCookies
      .find((c) => c.startsWith('shop_rt='))!
      .split(';')[0]!
      .split('=')[1]!;

    const refreshed = await a.post('/api/auth/refresh');
    expect(refreshed.status).toBe(200);

    const secondCookies = refreshed.headers['set-cookie'] as unknown as string[];
    const secondRefresh = secondCookies
      .find((c) => c.startsWith('shop_rt='))!
      .split(';')[0]!
      .split('=')[1]!;

    expect(secondRefresh).not.toBe(firstRefresh);

    // Replaying the old token must fail -- this is what makes a stolen refresh
    // token usable at most once.
    const replay = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `shop_rt=${firstRefresh}`);
    expect(replay.status).toBe(401);
  });

  it('logout revokes the session and clears all three cookies', async () => {
    const a = await signIn('shopper@test.local', 'Correct!Horse9');
    expect((await a.get('/api/auth/me')).status).toBe(200);

    const out = await a.post('/api/auth/logout');
    expect(out.status).toBe(204);

    const cleared = out.headers['set-cookie'] as unknown as string[];
    for (const name of ['shop_at=', 'shop_rt=', 'shop_session=']) {
      const cookie = cleared.find((c) => c.startsWith(name));
      expect(cookie, `${name} should be cleared`).toBeDefined();
      expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
    }

    expect((await a.get('/api/auth/me')).status).toBe(401);
  });

  it('changing a password revokes every other session', async () => {
    const user = await createUser('rotator@test.local', 'Original!Pass9');

    const deviceA = await signIn('rotator@test.local', 'Original!Pass9');
    const deviceB = await signIn('rotator@test.local', 'Original!Pass9');

    const changed = await deviceA
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Original!Pass9', newPassword: 'Replacement!Pass9' });
    expect(changed.status).toBe(204);

    const live = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    });
    // Every refresh token is dead -- the point of changing a password after a
    // compromise is that the other party is logged out.
    expect(live).toBe(0);

    expect((await deviceB.post('/api/auth/refresh')).status).toBe(401);

    // And the new password works.
    const relogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'rotator@test.local', password: 'Replacement!Pass9' });
    expect(relogin.status).toBe(200);
  });

  it('refuses a password change with the wrong current password', async () => {
    const a = await signIn('shopper@test.local', 'Correct!Horse9');
    const res = await a
      .post('/api/auth/change-password')
      .send({ currentPassword: 'wrong', newPassword: 'Something!New99' });
    expect(res.status).toBe(401);
  });
});

describe('authorisation', () => {
  const PROTECTED: [string, string][] = [
    ['get', '/api/auth/me'],
    ['get', '/api/orders'],
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/orders'],
    ['get', '/api/admin/products'],
  ];

  it.each(PROTECTED)('%s %s is 401 with no credentials at all', async (method, path) => {
    const res = await (request(app) as unknown as Record<string, (p: string) => request.Test>)[
      method
    ]!(path);
    expect(res.status).toBe(401);
  });

  it('refuses admin mutations to an anonymous caller', async () => {
    const stock = await request(app)
      .patch('/api/admin/variants/anything/stock')
      .send({ stock: 9999 });
    expect(stock.status).toBe(401);

    const paid = await request(app).post('/api/admin/orders/SHOP-000001/mark-paid');
    expect(paid.status).toBe(401);
  });

  it('refuses a token signed with the wrong secret', async () => {
    // Forged by an attacker who knows the shape but not the key.
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign(
      { sub: 'someone', role: 'ADMIN', email: 'attacker@test.local' },
      'a-secret-that-is-definitely-not-the-real-one',
      { issuer: 'shop-api', audience: 'shop-web', expiresIn: '1h' },
    );

    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('gives a CUSTOMER 403 on admin routes, and an ADMIN 200', async () => {
    const customer = await signIn('shopper@test.local', 'Correct!Horse9');
    expect((await customer.get('/api/admin/stats')).status).toBe(403);

    const admin = await signIn('boss@test.local', 'Admin!Passw0rd');
    expect((await admin.get('/api/admin/stats')).status).toBe(200);
  });

  it('honours a demotion immediately, not when the token expires', async () => {
    const demoted = await createUser('temp.admin@test.local', 'Admin!Passw0rd', Role.ADMIN);
    const a = await signIn('temp.admin@test.local', 'Admin!Passw0rd');
    expect((await a.get('/api/admin/stats')).status).toBe(200);

    // Same token, role changed underneath it. The guard re-reads the row, so
    // this must fail straight away rather than staying valid for the remaining
    // lifetime of the access token.
    await prisma.user.update({ where: { id: demoted.id }, data: { role: Role.CUSTOMER } });

    expect((await a.get('/api/admin/stats')).status).toBe(403);
  });

  it('cannot escalate its own role through the profile endpoint', async () => {
    const a = await signIn('shopper@test.local', 'Correct!Horse9');
    const res = await a.patch('/api/auth/me').send({ name: 'Renamed', role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('CUSTOMER');

    const row = await prisma.user.findUnique({ where: { email: 'shopper@test.local' } });
    expect(row?.role).toBe('CUSTOMER');
    expect(row?.name).toBe('Renamed');
  });
});
