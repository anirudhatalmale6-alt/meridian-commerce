import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env, isProd, isTest } from './env.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogRouter } from './modules/catalog/catalog.routes.js';
import { cartRouter } from './modules/cart/cart.routes.js';
import { ordersRouter } from './modules/orders/orders.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { prisma } from './prisma.js';

export function createApp() {
  const app = express();

  // Behind a load balancer or reverse proxy, req.ip is the proxy's address
  // unless this is set -- which would rate-limit the whole internet as one
  // client and log every request as coming from 127.0.0.1.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  app.use(
    cors({
      // Explicit allow-list from config. There is no `origin: true` fallback:
      // reflecting an arbitrary Origin while sending credentials lets any site
      // the user visits call this API as them.
      origin(origin, callback) {
        // No Origin header means a same-origin or non-browser caller (curl,
        // server-to-server, health checks) -- nothing to authorise.
        if (!origin) return callback(null, true);
        if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed.`));
      },
      credentials: true,
    }),
  );

  // 100kb is plenty for this API's payloads. The default of 100kb is not
  // guaranteed across versions, so it is pinned -- an unbounded body parser is
  // a free memory-exhaustion primitive.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  if (!isTest) {
    app.use(morgan(isProd ? 'combined' : 'dev'));
  }

  // Blanket limiter as a backstop; the auth routes add a tighter one of their own.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: isTest ? 100_000 : 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  // Liveness vs readiness are different questions. /health says the process is
  // up; /ready says it can actually serve, which means the database answers.
  // A load balancer pointed at the wrong one keeps sending traffic to a box
  // whose database connection died.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.get('/ready', (_req, res) => {
    void prisma.$queryRaw`SELECT 1`
      .then(() => res.json({ status: 'ready', database: 'up' }))
      .catch(() => res.status(503).json({ status: 'degraded', database: 'down' }));
  });

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/cart', cartRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
