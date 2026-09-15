import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // Tests share one Postgres database and TRUNCATE between files, so they
    // must not run concurrently -- two files resetting the same tables would
    // pull the rug from under each other and fail at random.
    fileParallelism: false,
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
