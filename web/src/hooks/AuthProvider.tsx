import { useCallback, useMemo, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../lib/api';
import type { Address, User } from '../lib/types';
import { AuthContext, type AuthContextValue } from './authContext';

interface MeResponse {
  user: User;
  addresses: Address[];
}

/**
 * Does this browser claim to hold a session?
 *
 * The access and refresh cookies are httpOnly and invisible to this code, so
 * the server also sets a readable `shop_session=1` flag next to them. Checking
 * it means an anonymous visitor makes NO auth request at all, instead of a
 * guaranteed 401 on /auth/me followed by a second guaranteed 401 on the
 * refresh attempt.
 *
 * It is a hint, not a credential. If somebody sets it by hand the only effect
 * is that the app asks the server, and the server says 401.
 */
function hasSessionHint(): boolean {
  return document.cookie.split('; ').some((c) => c.startsWith('shop_session='));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const me = useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      if (!hasSessionHint()) return null;
      try {
        return await api.get<MeResponse>('/auth/me');
      } catch (err) {
        // A 401 here means "nobody is signed in", which is a normal state for a
        // shop, not an error. Returning null keeps it out of the error path so
        // the UI does not show a failure banner to every anonymous visitor.
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    // The session is checked once per app load and after auth mutations. It is
    // not refetched on every window focus -- that fires a request each time the
    // user tabs back, for information that has not changed.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  /**
   * After any auth change the cart MUST be refetched, not just the user.
   * Logging in merges the guest cart server-side, so the cached cart from two
   * seconds ago is now wrong -- and a cart badge that still says 3 after a
   * merge that made it 5 is the bug customers notice first.
   */
  const invalidateSession = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['me'] }),
      queryClient.invalidateQueries({ queryKey: ['cart'] }),
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
    ]);
  }, [queryClient]);

  const loginMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api.post<{ user: User }>('/auth/login', vars, true),
    onSuccess: invalidateSession,
  });

  const registerMutation = useMutation({
    mutationFn: (vars: { email: string; password: string; name: string }) =>
      api.post<{ user: User }>('/auth/register', vars, true),
    onSuccess: invalidateSession,
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.post<void>('/auth/logout', undefined, true),
    onSuccess: async () => {
      // Clear rather than invalidate: the signed-out view must not briefly
      // render the previous user's orders while a refetch is in flight.
      queryClient.setQueryData(['me'], null);
      queryClient.removeQueries({ queryKey: ['orders'] });
      queryClient.removeQueries({ queryKey: ['admin'] });
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data?.user ?? null,
      addresses: me.data?.addresses ?? [],
      isLoading: me.isLoading,
      isAdmin: me.data?.user.role === 'ADMIN',
      login: async (email, password) => (await loginMutation.mutateAsync({ email, password })).user,
      register: async (email, password, name) =>
        (await registerMutation.mutateAsync({ email, password, name })).user,
      logout: async () => {
        await logoutMutation.mutateAsync();
      },
    }),
    [me.data, me.isLoading, loginMutation, registerMutation, logoutMutation],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
