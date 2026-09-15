import type { User } from '@prisma/client';

/**
 * The ONLY way a user object leaves this API.
 *
 * It is an explicit allow-list, not a `delete user.passwordHash` on the way
 * out. Blocklists rot: someone adds a `resetToken` column next month, nobody
 * updates the delete, and it ships in every JSON response. With an allow-list
 * a new column is invisible until somebody deliberately exposes it.
 */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: User['role'];
  phone: string | null;
  createdAt: Date;
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    phone: user.phone,
    createdAt: user.createdAt,
  };
}
