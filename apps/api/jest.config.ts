import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    // Exclude spec files and pure-wiring infrastructure (no logic to unit-test)
    '!src/**/*.spec.ts',
    '!src/main.ts',
    '!src/create-app.ts',
    '!src/app.module.ts',
    '!src/mikro-orm.config.ts',
    '!src/migrations/**',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
    '!src/**/*.entity.ts',
    // Controllers are integration-tested; exclude to avoid skewing global threshold
    '!src/**/*.controller.ts',
    '!src/redis/redis.provider.ts',
    // Pure delegation wrappers — no unit-testable logic
    '!src/**/*.guard.ts',
    // JwtStrategy constructor reads keys from disk; validate() logic covered by integration tests
    '!src/auth/strategies/jwt.strategy.ts',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 70,
      functions: 80,
      statements: 80,
    },
  },
  moduleNameMapper: {
    '^@adyton/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@adyton/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
};

export default config;
