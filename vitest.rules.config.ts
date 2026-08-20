import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/rules-tests/**/*.integration.ts'],
    fileParallelism: false,
  },
});
