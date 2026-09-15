import 'dotenv/config';
import { z } from 'zod';

/**
 * Config is validated once, at boot, and the process refuses to start if
 * anything is missing or nonsensical.
 *
 * The reason this file exists at all: a missing secret that defaults to
 * something harmless-looking is the worst failure mode in an auth system.
 * `process.env.JWT_ACCESS_SECRET ?? 'dev'` ships to production and signs real
 * tokens with the string "dev". So there are no fallbacks for secrets here --
 * absent means crash, loudly, at startup, where somebody will see it.
 */

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .or(z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),

  // 32 chars is not a style preference. A short HMAC secret is brute-forceable
  // offline, and the whole session model rests on these two values.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),

  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  COOKIE_SECURE: bool.default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

  BANK_ACCOUNT_NAME: z.string().default('Acme Commerce Ltd'),
  BANK_ACCOUNT_NUMBER: z.string().default(''),
  BANK_SORT_CODE: z.string().default(''),
  BANK_IBAN: z.string().default(''),
  BANK_SWIFT: z.string().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');

  console.error(`\nInvalid environment configuration:\n${issues}\n\nSee .env.example.\n`);
  process.exit(1);
}

export const env = parsed.data;

// Reusing one secret for both token kinds means a refresh token verifies as an
// access token and never expires in practice. Cheap check, catches a copy-paste.
if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  console.error('\nJWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values.\n');
  process.exit(1);
}

// SameSite=None without Secure is silently dropped by every current browser,
// which presents as "login works locally, nobody can log in on staging".
if (env.COOKIE_SAMESITE === 'none' && !env.COOKIE_SECURE) {
  console.error(
    '\nCOOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers drop the cookie otherwise).\n',
  );
  process.exit(1);
}

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
