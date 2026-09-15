import 'dotenv/config';

/**
 * Point the process at the TEST database before anything imports Prisma.
 *
 * This runs as a vitest setupFile, which is evaluated before the test modules,
 * so the PrismaClient constructed inside src/prisma.ts reads the overridden
 * DATABASE_URL. Getting this order wrong is how a test suite truncates the
 * development database -- hence the hard failure below rather than a fallback.
 */
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Refusing to run the suite against DATABASE_URL, ' +
      'because these tests truncate every table. See .env.example.',
  );
}

if (testUrl === process.env.DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL and DATABASE_URL are the same database. The suite truncates ' +
      'tables, so this would wipe your development data.',
  );
}

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
