import type { Request } from 'express';

/**
 * Typed cookie accessor.
 *
 * `cookie-parser` declares `req.cookies` as `any`, so every `req.cookies.foo`
 * is an unchecked value that TypeScript will happily let you pass anywhere --
 * including into a database query. Funnelling every read through here means a
 * cookie is a `string | undefined` and nothing else, which is what the callers
 * actually assume.
 *
 * Empty strings come back as undefined: a cleared cookie and an absent one mean
 * the same thing to every caller, and collapsing them here removes a `if (x &&
 * x.length)` from each one.
 */
export function readCookie(req: Request, name: string): string | undefined {
  const jar: unknown = req.cookies;
  if (typeof jar !== 'object' || jar === null) return undefined;

  const value = (jar as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}
