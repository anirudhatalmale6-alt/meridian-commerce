import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

/**
 * Graceful shutdown. Without it, a deploy kills the process mid-request and the
 * customer who was checking out at that moment sees a connection reset -- with
 * an order that may or may not have been written.
 */
function shutdown(signal: string) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received, draining connections...`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  // Hard ceiling, so a stuck keep-alive connection cannot hold the deploy open.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
