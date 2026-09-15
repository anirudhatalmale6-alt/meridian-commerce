import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/asyncHandler.js';
import { attachGuestSession, attachUser } from '../../auth/middleware.js';
import { badRequest } from '../../http/errors.js';
import type { CartOwner } from './cart.service.js';
import { addItem, clearCart, getCart, removeItem, setItemQuantity } from './cart.service.js';
import type { Request } from 'express';

export const cartRouter = Router();

// Every cart route resolves an owner, signed in or not. Order matters:
// attachUser first so a logged-in shopper is never handed the guest cart.
cartRouter.use(attachUser, attachGuestSession);

function ownerOf(req: Request): CartOwner {
  if (req.user) return { userId: req.user.id };
  if (req.guestSessionId) return { sessionId: req.guestSessionId };
  // attachGuestSession guarantees one of these, so this is a programming
  // error, not a user error -- fail loudly rather than inventing a cart.
  throw badRequest('No cart session could be established. Enable cookies and retry.');
}

const addSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
});

const qtySchema = z.object({ quantity: z.number().int().min(0).max(99) });

cartRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ cart: await getCart(ownerOf(req)) });
  }),
);

cartRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const body = addSchema.parse(req.body);
    res.status(201).json({ cart: await addItem(ownerOf(req), body.variantId, body.quantity) });
  }),
);

cartRouter.patch(
  '/items/:variantId',
  asyncHandler(async (req, res) => {
    const body = qtySchema.parse(req.body);
    const cart = await setItemQuantity(ownerOf(req), req.params.variantId!, body.quantity);
    res.json({ cart });
  }),
);

cartRouter.delete(
  '/items/:variantId',
  asyncHandler(async (req, res) => {
    res.json({ cart: await removeItem(ownerOf(req), req.params.variantId!) });
  }),
);

cartRouter.delete(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ cart: await clearCart(ownerOf(req)) });
  }),
);
