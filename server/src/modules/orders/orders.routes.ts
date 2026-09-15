import { Router } from 'express';
import { OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { attachUser, requireAuth } from '../../auth/middleware.js';
import { forbidden, notFound } from '../../http/errors.js';
import { bankDetails, changeStatus, createOrderFromCart, orderInclude } from './orders.service.js';
import { CUSTOMER_ALLOWED } from './order.status.js';

export const ordersRouter = Router();

ordersRouter.use(attachUser, requireAuth);

const shippingSchema = z.object({
  fullName: z.string().trim().min(1, 'Who is this going to?').max(120),
  line1: z.string().trim().min(1, 'Street address is required.').max(200),
  line2: z.string().trim().max(200).nullish(),
  city: z.string().trim().min(1, 'City is required.').max(120),
  region: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().min(1, 'Postcode is required.').max(32),
  // ISO 3166-1 alpha-2, uppercased. Storing "United Kingdom" and "UK" and "gb"
  // in one column makes shipping rules and tax rules impossible later.
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'Use a 2-letter country code, e.g. GB.'),
  phone: z.string().trim().max(40).nullish(),
});

const checkoutSchema = z.object({
  shipping: shippingSchema,
  customerNote: z.string().trim().max(1000).nullish(),
  saveAddress: z.boolean().default(false),
});

ordersRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const body = checkoutSchema.parse(req.body);
    const userId = req.user!.id;

    const order = await createOrderFromCart(userId, body.shipping, body.customerNote);

    if (body.saveAddress) {
      // Saved outside the order transaction on purpose: failing to save an
      // address book entry must never roll back a completed purchase.
      await prisma.address
        .create({
          data: {
            userId,
            fullName: body.shipping.fullName,
            line1: body.shipping.line1,
            line2: body.shipping.line2 ?? null,
            city: body.shipping.city,
            region: body.shipping.region ?? null,
            postalCode: body.shipping.postalCode,
            country: body.shipping.country,
            phone: body.shipping.phone ?? null,
          },
        })
        .catch(() => undefined);
    }

    res.status(201).json({
      order,
      payment: {
        method: 'BANK_TRANSFER',
        reference: order.paymentReference,
        amountCents: order.totalCents,
        currency: order.currency,
        bank: bankDetails(),
        instructions:
          'Transfer the exact total and quote the reference above. Your order ships once the payment lands and we mark it received.',
      },
    });
  }),
);

ordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const perPage = Math.min(50, Math.max(1, Number(req.query.perPage ?? 10) || 10));

    const [total, orders] = await prisma.$transaction([
      prisma.order.count({ where: { userId: req.user!.id } }),
      prisma.order.findMany({
        // Scoped to the caller in the QUERY, not filtered after fetching.
        // "Fetch all, then check ownership" is how one missed branch turns
        // into every customer reading every order.
        where: { userId: req.user!.id },
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    res.json({ orders, page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) });
  }),
);

ordersRouter.get(
  '/:orderNumber',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber! },
      include: orderInclude,
    });
    if (!order) throw notFound('Order not found.');

    // An admin may read anyone's order; a customer may read only their own.
    // Returning 404 rather than 403 to a stranger avoids confirming that an
    // order number exists at all.
    if (order.userId !== req.user!.id && req.user!.role !== 'ADMIN') {
      throw notFound('Order not found.');
    }

    res.json({
      order,
      ...(order.status === OrderStatus.AWAITING_PAYMENT
        ? {
            payment: {
              method: 'BANK_TRANSFER',
              reference: order.paymentReference,
              amountCents: order.totalCents,
              currency: order.currency,
              bank: bankDetails(),
            },
          }
        : {}),
    });
  }),
);

ordersRouter.post(
  '/:orderNumber/cancel',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber! },
    });
    if (!order) throw notFound('Order not found.');
    if (order.userId !== req.user!.id) throw notFound('Order not found.');

    const allowed = CUSTOMER_ALLOWED[order.status] ?? [];
    if (!allowed.includes(OrderStatus.CANCELLED)) {
      throw forbidden('This order can no longer be cancelled here -- please contact support.');
    }

    const updated = await changeStatus(
      order.id,
      OrderStatus.CANCELLED,
      req.user!.id,
      'Cancelled by customer.',
    );
    res.json({ order: updated });
  }),
);
