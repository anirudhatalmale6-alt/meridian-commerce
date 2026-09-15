import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Cart } from '../lib/types';

interface CartResponse {
  cart: Cart;
}

/**
 * The cart lives on the SERVER, not in localStorage or a client store.
 *
 * That is the whole reason it persists between sessions, survives a different
 * browser, and cannot be edited by the customer. Every mutation here returns
 * the authoritative cart from the API and writes it straight into the cache,
 * so the UI never computes a total the server would disagree with.
 */
export function useCart() {
  return useQuery<Cart>({
    queryKey: ['cart'],
    queryFn: async () => (await api.get<CartResponse>('/cart')).cart,
    staleTime: 30 * 1000,
  });
}

export function useCartMutations() {
  const queryClient = useQueryClient();

  // Every mutation takes the cart the server returned as the new truth. No
  // optimistic arithmetic: guessing the new subtotal locally means the badge
  // and the drawer briefly disagree with the invoice when a stock limit or a
  // price change makes the guess wrong.
  const write = (cart: Cart) => queryClient.setQueryData(['cart'], cart);

  const add = useMutation({
    mutationFn: async (vars: { variantId: string; quantity?: number }) =>
      (
        await api.post<CartResponse>('/cart/items', {
          variantId: vars.variantId,
          quantity: vars.quantity ?? 1,
        })
      ).cart,
    onSuccess: write,
  });

  const setQuantity = useMutation({
    mutationFn: async (vars: { variantId: string; quantity: number }) =>
      (
        await api.patch<CartResponse>(`/cart/items/${vars.variantId}`, {
          quantity: vars.quantity,
        })
      ).cart,
    onSuccess: write,
  });

  const remove = useMutation({
    mutationFn: async (variantId: string) =>
      (await api.del<CartResponse>(`/cart/items/${variantId}`)).cart,
    onSuccess: write,
  });

  const clear = useMutation({
    mutationFn: async () => (await api.del<CartResponse>('/cart')).cart,
    onSuccess: write,
  });

  return { add, setQuantity, remove, clear };
}
