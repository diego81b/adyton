import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '~': resolve(__dirname, './app'),
      '@': resolve(__dirname, './app'),
    },
  },
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
        'app/error.vue',               // Nuxt root error boundary; runtime-only clearError
        'app/app.config.ts',
        'app/pages/**',
        'app/layouts/**',            // Nuxt composition surface; covered by e2e/manual
        'app/workers/**',               // Web Workers require browser runtime; covered by e2e
        'app/composables/useArgon2Worker.ts',  // wraps Web Worker; covered by e2e
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
