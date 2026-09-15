import { Router } from 'express';
import { OrderStatus, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma.js';
import { asyncHandler } from '../../http/asyncHandler.js';
import { attachUser, requireRole } from '../../auth/middleware.js';
import { notFound } from '../../http/errors.js';
import { changeStatus, orderInclude } from '../orders/orders.service.js';

export const adminRouter = Router();

// One guard, applied to the whole router, before any handler is reachable.
// Per-route guards are how one forgotten line leaves an admin endpoint open --
// and requireRole re-reads the role from the database, so a stale token that
// still claims ADMIN does not get in.
adminRouter.use(attachUser, requireRole(Role.ADMIN));

adminRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [orderCount, awaiting, customers, productCount, revenue, lowStock] = await Promise.all([
      prisma.order.count(),
      prisma.order.count({ where: { status: OrderStatus.AWAITING_PAYMENT } }),
      prisma.user.count({ where: { role: Role.CUSTOMER } }),
      prisma.product.count({ where: { isActive: true } }),
      // Revenue counts only orders where money actually arrived. Summing every
      // order total would include unpaid and cancelled ones and overstate the
      // number on the dashboard -- the single most-screenshotted figure here.
      prisma.order.aggregate({
        where: {
          status: {
            in: [
              OrderStatus.PAYMENT_RECEIVED,
              OrderStatus.PROCESSING,
              OrderStatus.SHIPPED,
              OrderStatus.COMPLETED,
            ],
          },
        },
        _sum: { totalCents: true },
      }),
      prisma.productVariant.count({ where: { isActive: true, stock: { lte: 3 } } }),
    ]);

    res.json({
      orderCount,
      awaitingPayment: awaiting,
      customers,
      productCount,
      paidRevenueCents: revenue._sum.totalCents ?? 0,
      lowStockVariants: lowStock,
    });
  }),
);

const ordersQuery = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

adminRouter.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const query = ordersQuery.parse(req.query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { orderNumber: { contains: query.q, mode: 'insensitive' as const } },
              { paymentReference: { contains: query.q, mode: 'insensitive' as const } },
              { shipFullName: { contains: query.q, mode: 'insensitive' as const } },
              { user: { email: { contains: query.q, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [total, orders] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
    ]);

    res.json({
      orders,
      page: query.page,
      perPage: query.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.perPage)),
    });
  }),
);

const statusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  note: z.string().trim().max(1000).nullish(),
});

adminRouter.post(
  '/orders/:orderNumber/status',
  asyncHandler(async (req, res) => {
    const body = statusSchema.parse(req.body);
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber! },
    });
    if (!order) throw notFound('Order not found.');

    // The state machine, not the dropdown, decides whether this is legal.
    const updated = await changeStatus(order.id, body.status, req.user!.id, body.note);
    res.json({ order: updated });
  }),
);

/** Convenience wrapper for the commonest action in a bank-transfer shop. */
adminRouter.post(
  '/orders/:orderNumber/mark-paid',
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: req.params.orderNumber! },
    });
    if (!order) throw notFound('Order not found.');
    const updated = await changeStatus(
      order.id,
      OrderStatus.PAYMENT_RECEIVED,
      req.user!.id,
      'Bank transfer confirmed.',
    );
    res.json({ order: updated });
  }),
);

adminRouter.get(
  '/products',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage ?? 20) || 20));

    const [total, products] = await prisma.$transaction([
      prisma.product.count(),
      prisma.product.findMany({
        include: {
          category: true,
          variants: { orderBy: { sku: 'asc' } },
          images: { orderBy: { position: 'asc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);

    res.json({
      products,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    });
  }),
);

const stockSchema = z.object({ stock: z.number().int().min(0).max(1_000_000) });

adminRouter.patch(
  '/variants/:id/stock',
  asyncHandler(async (req, res) => {
    const body = stockSchema.parse(req.body);
    const exists = await prisma.productVariant.findUnique({ where: { id: req.params.id! } });
    if (!exists) throw notFound('Variant not found.');

    const variant = await prisma.productVariant.update({
      where: { id: req.params.id! },
      data: { stock: body.stock },
    });
    res.json({ variant });
  }),
);

const productPatchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  brand: z.string().trim().max(120).nullish(),
  isActive: z.boolean().optional(),
});

adminRouter.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const body = productPatchSchema.parse(req.body);
    const exists = await prisma.product.findUnique({ where: { id: req.params.id! } });
    if (!exists) throw notFound('Product not found.');

    const product = await prisma.product.update({
      where: { id: req.params.id! },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.brand !== undefined ? { brand: body.brand } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
      include: { variants: true, category: true },
    });
    res.json({ product });
  }),
);

const priceSchema = z.object({
  priceCents: z.number().int().min(0).max(100_000_000),
  compareAtCents: z.number().int().min(0).max(100_000_000).nullish(),
});

adminRouter.patch(
  '/variants/:id/price',
  asyncHandler(async (req, res) => {
    const body = priceSchema.parse(req.body);
    const exists = await prisma.productVariant.findUnique({ where: { id: req.params.id! } });
    if (!exists) throw notFound('Variant not found.');

    const variant = await prisma.productVariant.update({
      where: { id: req.params.id! },
      data: {
        priceCents: body.priceCents,
        ...(body.compareAtCents !== undefined ? { compareAtCents: body.compareAtCents } : {}),
      },
    });
    // Existing orders keep their snapshotted unitCents -- changing a price
    // today does not rewrite what anyone paid yesterday.
    res.json({ variant });
  }),
);
