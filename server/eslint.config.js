import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The codebase is deliberately explicit about unused values: an argument
      // prefixed with _ is documentation ("Express needs this in the
      // signature"), not an oversight.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `req.user!.id` after requireAuth is provably safe and clearer than a
      // second null check the middleware already performed.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Floating promises are a real bug class in Express handlers -- an
      // un-awaited write that rejects becomes an unhandled rejection and the
      // request hangs. Kept as an error, with `void` as the explicit opt-out.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      // console is the log transport here; a real deployment swaps in pino.
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    // Tests reach into the database and assert on loose response bodies, so
    // the any-flavoured rules would fire on every line of legitimate setup.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      'no-console': 'off',
    },
  },
);
