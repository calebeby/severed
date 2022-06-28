import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    includeSource: ['**.ts'],
    coverage: {
      reporter: ['text', 'cobertura'],
    },
  },
});
