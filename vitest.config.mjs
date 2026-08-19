import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/mocks/**', // mock data files — test infrastructure, not business logic
        'src/**/*.d.ts',
        'src/ranking/handler.ts', // Lambda entrypoint — infrastructure glue, not testable via Vitest
        'src/ranking/types.ts', // pure type declarations — no executable branches
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 85,
        statements: 85,
      },
    },
  },
})
