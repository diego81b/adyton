import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.spec.ts', 'app/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['app/**/*.ts', 'app/**/*.vue'],
      exclude: [
        'app/app.vue',
        'app/app.config.ts',
        'app/pages/**',
        '**/*.spec.ts',
        '**/*.config.ts',
      ],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
      },
    },
  },
});
