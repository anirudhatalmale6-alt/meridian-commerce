import { createContext, useContext } from 'react';
import type { Address, User } from '../lib/types';

/**
 * Auth context and its hook, kept apart from the provider component.
 *
 * Splitting them is not ceremony: Vite's fast refresh only preserves state for
 * a module whose exports are all components, so a file exporting both the
 * provider and a hook forces a full reload of the tree on every edit to either.
 */
export interface AuthContextValue {
  user: User | null;
  addresses: Address[];
  /** True only while we genuinely do not know yet -- used to avoid a login flash. */
  isLoading: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, name: string) => Promise<User>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  // Throwing beats returning a fake empty user: a component rendered outside
  // the provider would otherwise look signed-out forever and nobody would
  // know why.
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
